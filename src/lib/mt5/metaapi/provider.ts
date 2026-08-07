import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  FetchDealsOptions,
  Mt5AccountState,
  Mt5Credentials,
  Mt5Deal,
  Mt5Provider,
  Mt5VerifyResult,
  SymbolSpecOverride,
} from '../types';
import { normalizeSymbol } from '../symbols';

/**
 * MetaApi (metaapi.cloud) — the server-side connection SPEC §3.3 settles on.
 *
 * Why a REST client rather than the official SDK: the SDK opens a persistent WebSocket and
 * keeps a synchronised terminal per account in memory. That is the right shape for a trading
 * bot and the wrong one for TRi, which reads history on login and then does nothing for hours
 * — it would hold a socket per client for no benefit. The REST history API returns exactly
 * what the sync needs in one call.
 *
 * **This is wired but unproven.** It has never run against a live MetaApi account, because
 * doing so needs the client's own subscription (SPEC §2 puts that cost on them) and a real
 * broker account. The shapes below follow MetaApi's documented provisioning and history-deal
 * formats. Treat the first live connection as an integration task: the part most likely to
 * still need adjusting is the deal→position aggregation, marked below.
 *
 * The provisioning dance, which is what a first live connection actually trips over:
 *
 *  1. `POST /users/current/accounts` both *adds* the account and *starts* its cloud API
 *     server — the documented success body is `{ id, state: 'DEPLOYED' }`. It is not a
 *     create-then-deploy pair; `deploy` is documented as "ignored if the account is already
 *     deployed" and is the remedy for an account that was stopped, not a mandatory step.
 *  2. The request needs a **`transaction-id`** header. It is documented as required, and a
 *     `202` answer means "broker settings detection is still running, retry with the same
 *     transaction id" rather than "done".
 *  3. Starting is not the same as ready. `GET account-information` documents
 *     "404 — MetaTrader account not found or not provisioned yet", so the account is polled
 *     until `state=DEPLOYED` *and* `connectionStatus=CONNECTED` before it is read.
 *  4. Every client call must go to the region the account lives in, or it 404s against a host
 *     that does not hold it — so the region is one value here, used both to build the client
 *     host and to create the account.
 */

const DEFAULT_REGION = 'new-york';

/** How long a first connection may spend waiting for MetaApi to bring the account up. */
const DEFAULT_READY_TIMEOUT_MS = 120_000;

/** Gap between readiness polls, and the fallback when a 202 carries no `Retry-After`. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** `limit` is documented as min 1, max 1000, default 1000. Ask for the maximum. */
const DEALS_PAGE_SIZE = 1000;

/**
 * A stop on the pagination loop. 200 pages is 200 000 deals — far past any account a person
 * trades by hand, so reaching it means the API is not honouring `offset` and looping forever
 * would be the worse failure.
 */
const DEALS_PAGE_LIMIT = 200;

/**
 * Broker company names, keyed by the prefix brokers put on their server names.
 *
 * `keywords` is documented as what MetaApi searches its broker-server list by, with the advice
 * to "include exact broker company name in this list" — and the company name is rarely the
 * word in the server name. FTMO's own login instructions tell traders to search for
 * "FTMO Global Markets Ltd" while their servers are called `FTMO-Server4`. Anything not
 * listed here falls back to the prefix, which is a worse hint than the company name but a
 * better one than nothing.
 */
const BROKER_COMPANIES: Record<string, string> = {
  ftmo: 'FTMO Global Markets Ltd',
  icmarketssc: 'Raw Trading Ltd',
};

export function brokerKeywords(server: string): string[] {
  const prefix = server.trim().split(/[-_ ]/)[0] ?? '';
  const company = BROKER_COMPANIES[prefix.toLowerCase()];
  const keyword = company ?? prefix;
  return keyword ? [keyword] : [];
}

/**
 * The name TRi registers an account under — and the thing that keeps one client's broker
 * account out of another client's reach.
 *
 * MetaApi's account list is shared by everyone on the subscription, so the name is the only
 * place we can write down *whose* registration this is. `findAccount` matches on it, which is
 * why the format has to be stable: change it and every existing account stops being found and
 * is silently registered a second time. Restricted to characters no provider is likely to
 * argue with, and to a length no provider is likely to truncate — a truncated name would
 * collide across users, which is the failure this exists to prevent.
 */
export function accountName(credentials: Pick<Mt5Credentials, 'accountKey' | 'login'>): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  return `tri-${safe(credentials.accountKey)}-${safe(credentials.login)}`;
}

/**
 * What a trader is told to do when the server name is right and MetaApi still cannot find it.
 *
 * Deliberately not a user-visible string: `detail` is carried for the log and for whoever is
 * debugging a stuck connection, while the screen renders a translated message keyed off
 * `reason` (see `connectError` in the settings actions). MetaApi's documented escalation is a
 * provisioning profile built from the broker terminal's own `servers.dat`; TRi has no upload
 * flow for that, so the least it can do is name the file.
 */
const PROVISIONING_PROFILE_HINT =
  'If the server name is correct and this keeps failing, MetaApi could not auto-detect this ' +
  'broker. The documented remedy is a provisioning profile built from the broker terminal\'s ' +
  'servers.dat (MetaTrader 5 → File → Open Data Folder → config/servers.dat), uploaded with ' +
  'PUT /users/current/provisioning-profiles/:id/servers.dat and passed as provisioningProfileId. ' +
  'TRi has no upload flow for that yet — it is a manual step in the MetaApi dashboard.';

/**
 * A MetaApi failure, with the parts of the response worth acting on.
 *
 * The previous version threw `new Error('MetaApi 400 Bad Request')` and dropped the body,
 * which is where MetaApi puts the reason. For a wrong server name the body says
 * `E_SRV_NOT_FOUND` and lists the names it *does* know for the broker it detected — the one
 * piece of information that turns "connection failed" into a fixable mistake.
 */
class MetaApiError extends Error {
  private constructor(
    readonly status: number,
    message: string,
    private readonly body: unknown,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  static async from(response: Response): Promise<MetaApiError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON, or empty. The status alone still tells the caller something.
    }
    const detail =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : response.statusText;
    return new MetaApiError(response.status, `MetaApi ${response.status} ${detail}`, body);
  }

  /**
   * The machine-readable reason, from where MetaApi actually puts it.
   *
   * The documented envelope is
   * `{ id: 3, error: 'ValidationError', message, details: { code, ... } }` — `id` is a number,
   * not the code, and `details` is sometimes a bare string (`"E_AUTH"`,
   * `"E_SERVER_TIMEZONE"`, `"E_NO_SYMBOLS"`) rather than an object.
   */
  code(): string | null {
    const details = (this.body as { details?: unknown } | null)?.details;
    if (typeof details === 'string') return details;
    if (details && typeof details === 'object') {
      const code = (details as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    return null;
  }

  /**
   * The subscription is unpaid, rather than the credentials being wrong.
   *
   * MetaApi will register an account for free but will not *start* one, and it says so with a
   * 403 — the same status it uses for a rejected token. Matched on the sentence because the
   * body carries no machine-readable code for it: `{"error":"ForbiddenError","message":"To
   * allow trading account deployment please top up your account.","details":{}}`.
   */
  isBillingProblem(): boolean {
    return /top up your account|insufficient funds|please top up/i.test(this.message);
  }

  isUnknownServer(): boolean {
    if (this.code() === 'E_SRV_NOT_FOUND') return true;
    // Kept as a backstop only: MetaApi is free to reword a sentence, so the code above is the
    // load-bearing check and this catches an older or undocumented phrasing.
    return /\.dat file for server|please check the server name/i.test(this.message);
  }

  /**
   * The server names MetaApi knows for the broker it did detect.
   *
   * The documented shape is `details.serversByBrokers`, an object mapping a broker company
   * name to its server names — e.g.
   * `{ "Raw Trading Ltd": ["ICMarketsSC-Demo", "ICMarketsSC-MT5"] }`. An empty list is a
   * perfectly good answer; the wizard then simply asks the user to check the name themselves.
   */
  serverSuggestions(): string[] {
    const details = (this.body as { details?: unknown } | null)?.details;
    if (!details || typeof details !== 'object') return [];

    const byBroker = (details as { serversByBrokers?: unknown }).serversByBrokers;
    if (!byBroker || typeof byBroker !== 'object') return [];

    const names = Object.values(byBroker as Record<string, unknown>)
      .flatMap((servers) => (Array.isArray(servers) ? servers : []))
      .filter((name): name is string => typeof name === 'string');

    return [...new Set(names)].slice(0, 5);
  }
}

type MetaApiDeal = {
  id: string;
  type: string;
  entryType?: string;
  symbol?: string;
  volume?: number;
  price?: number;
  time: string;
  positionId?: string;
  commission?: number;
  swap?: number;
  profit?: number;
  stopLoss?: number;
  takeProfit?: number;
};

/** The account as the provisioning API reports it. */
type MetaApiAccount = {
  _id?: string;
  id?: string;
  /** Ours, and load-bearing: `accountName` puts the owning user in it. See `findAccount`. */
  name?: string;
  login?: string | number;
  server?: string;
  /** CREATED | DEPLOYING | DEPLOYED | DEPLOY_FAILED | UNDEPLOYING | UNDEPLOYED | … */
  state?: string;
  /** CONNECTED | DISCONNECTED | DISCONNECTED_FROM_BROKER */
  connectionStatus?: string;
};

export type MetaApiProviderOptions = {
  /** Overall bound on waiting for an account to come up. A sync must not hang forever. */
  readyTimeoutMs?: number;
  /**
   * Leave the terminal running between syncs.
   *
   * Costs $9.20 a month rather than $0.77 and saves the minute a cold start spends connecting
   * to the broker. Worth it above roughly four syncs a day, where the per-deployment fee
   * overtakes the idle hours it avoids.
   */
  keepDeployed?: boolean;
  pollIntervalMs?: number;
  /** Test seam, so the readiness wait can be exercised without real time passing. */
  sleep?: (ms: number) => Promise<void>;
};

export class MetaApiProvider implements Mt5Provider {
  readonly name = 'metaapi' as const;

  private readonly readyTimeoutMs: number;
  private readonly keepDeployed: boolean;
  private readonly pollIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * Ids resolved during this process's lifetime, keyed by login+server.
   *
   * One sync calls `fetchAccountState`, `fetchDeals` and `fetchSymbolSpecs`, each of which
   * needs the id; without this the account list was fetched three times per sync. The stored
   * `mt5_accounts.provider_account_id` is the durable version of the same thing and skips the
   * listing entirely — see `Mt5Credentials.providerAccountId`.
   */
  private readonly resolved = new Map<string, Promise<string>>();

  constructor(
    private readonly token: string,
    /**
     * The single source of truth for *where* the account lives: it builds the client host and
     * it is sent when the account is created. These two used to be able to disagree — the
     * region was only ever used for the URL, so MetaApi picked its own region for the account
     * and every subsequent client call 404'd against a host that did not hold it.
     */
    private readonly region: string = DEFAULT_REGION,
    options: MetaApiProviderOptions = {},
  ) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.keepDeployed = options.keepDeployed ?? false;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private get provisioningUrl(): string {
    return 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
  }

  private get clientUrl(): string {
    return `https://mt-client-api-v1.${this.region}.agiliumtrade.ai`;
  }

  private async send(
    url: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { 'auth-token': this.token, 'content-type': 'application/json', ...init.headers },
      // History can be large and the provider is not always quick; a hung sync must not hold
      // a request open forever.
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      // The *response* body is safe to read — it is MetaApi's own error, and it carries the
      // detail that makes a failure actionable (see `MetaApiError`). The *request* body is
      // the one that must never be logged: it holds the investor password.
      throw await MetaApiError.from(response);
    }
    return response;
  }

  private async request<T>(
    url: string,
    init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await this.send(url, init);
    return (await response.json()) as T;
  }

  /**
   * MetaApi requires the account to be registered with them before it can be read. The id is
   * cached on `mt5_accounts.provider_account_id` so this happens once per client; pass it back
   * in as `credentials.providerAccountId` and none of the provisioning below runs at all.
   */
  /**
   * The memo key, in one place because two copies of it would drift.
   *
   * Keyed on the owner as well as the account: `mt5Provider()` caches one instance for the
   * whole process, so a key without the owner would let this memo answer one user's lookup
   * with another user's resolution — the same hole `findAccount` closes on the wire.
   */
  private memoKey(credentials: Mt5Credentials): string {
    return `${credentials.accountKey}\0${credentials.login}\0${credentials.server.toLowerCase()}`;
  }

  private async resolveAccountId(credentials: Mt5Credentials): Promise<string> {
    // The fast path, and the reason the column exists: a known id is a straight answer with no
    // request at all. If the account has since been undeployed the client call fails and the
    // sync reports an error, which is the same outcome as any other broker-side problem.
    if (credentials.providerAccountId) return credentials.providerAccountId;

    const key = this.memoKey(credentials);
    const pending = this.resolved.get(key);
    if (pending) return pending;

    const attempt = this.provisionAccount(credentials).catch((error: unknown) => {
      // A failed provision must not be remembered, or one bad password poisons the process.
      this.resolved.delete(key);
      throw error;
    });
    this.resolved.set(key, attempt);
    return attempt;
  }

  /**
   * One deadline for the whole provisioning handshake, not one per step.
   *
   * `createAccount` waits out MetaApi's "still detecting the broker" 202s and `waitUntilReady`
   * waits for the terminal to connect; giving each its own budget means a slow broker can
   * spend both, and this runs inside `connectMt5Action`, a form submission. Behind nginx's
   * default 60s `proxy_read_timeout` the trader would get a gateway error while the request
   * carried on server-side — and their retry is refused, because the rate-limit token was
   * spent before any of this started.
   */
  private async provisionAccount(credentials: Mt5Credentials): Promise<string> {
    const deadline = Date.now() + this.readyTimeoutMs;
    const existing = await this.findAccount(credentials);
    const accountId = existing ?? (await this.createAccount(credentials, deadline));
    await this.waitUntilReady(accountId, deadline);
    return accountId;
  }

  /**
   * Looks for an account this **same user** already registered under the shared token.
   *
   * Matching on login and server is not enough, and the difference is a real breach rather
   * than a tidiness point. Every client's account lives under one MetaApi subscription, so
   * that list is a namespace all our users share, and this lookup runs *before* anything the
   * caller typed has been checked against the broker. Match on login and server alone and the
   * second user to enter someone else's account number gets handed their account id, with any
   * password at all: `verify` succeeds, the settings screen shows their balance, and the next
   * backfill copies their entire history into the wrong journal. MT5 logins are eight digits
   * and server names are printed on the broker's own login screen, so that costs an attacker
   * nothing to guess.
   *
   * The name carries the owner, so a user only ever finds an account they provisioned
   * themselves. Anybody else supplying the same login gets no match here, falls through to
   * `createAccount`, and is turned away by the broker — which is the only party entitled to
   * judge a password. Two users legitimately sharing one MT5 account each get their own
   * MetaApi registration, which costs a second connected account and is the correct price.
   */
  private async findAccount(credentials: Mt5Credentials): Promise<string | null> {
    const accounts = await this.request<MetaApiAccount[]>(
      `${this.provisioningUrl}/users/current/accounts?query=${encodeURIComponent(credentials.login)}`,
    );

    const wantedName = accountName(credentials);
    const wantedServer = credentials.server.trim().toLowerCase();
    const match = accounts.find(
      (account) =>
        (account.name ?? '') === wantedName &&
        String(account.login ?? '') === credentials.login &&
        (account.server ?? '').trim().toLowerCase() === wantedServer,
    );

    return match ? (match._id ?? match.id ?? null) : null;
  }

  /**
   * Creates the account, which also starts its API server and terminal.
   *
   * `transaction-id` is documented as required; a 202 means broker settings detection is still
   * running and must be retried with the *same* transaction id, honouring `Retry-After`. The
   * old code treated 202 as success, read `id` off a body that has only a `message`, and then
   * asked for `/accounts/undefined/account-information` — a confusing 404 in place of "still
   * provisioning".
   */
  private async createAccount(credentials: Mt5Credentials, deadline: number): Promise<string> {
    const transactionId = randomUUID().replace(/-/g, '');
    const keywords = brokerKeywords(credentials.server);
    const body = JSON.stringify({
      login: credentials.login,
      // Read-only by construction: MetaApi's own term for an investor connection.
      password: credentials.investorPassword,
      // Carries the owner: this is what `findAccount` matches on. Not cosmetic.
      name: accountName(credentials),
      server: credentials.server,
      platform: 'mt5',
      // 'cloud' is a documented alias of this; sending it explicitly says which one we mean.
      type: 'cloud-g2',
      // Must match the host in `clientUrl`, or every client call 404s.
      region: this.region,
      // The documented default, and the only option offered on cloud-g2. Sent as intent.
      reliability: 'high',
      // "When manualTrades is set to true, magic value must be 0" — and this is by definition
      // a human trader's account, so the 0 is declared rather than incidental.
      magic: 0,
      manualTrades: true,
      ...(keywords.length > 0 ? { keywords } : {}),
    });

    for (;;) {
      const response = await this.send(`${this.provisioningUrl}/users/current/accounts`, {
        method: 'POST',
        body,
        headers: { 'transaction-id': transactionId },
      });

      if (response.status === 202) {
        // "Automatic broker settings detection is in progress, please retry in 60 seconds."
        const wait = retryAfterMs(response) ?? this.pollIntervalMs;
        if (Date.now() + wait > deadline) {
          throw new Error(
            `MetaApi is still detecting the broker settings for ${credentials.server} after ` +
              `${Math.round(this.readyTimeoutMs / 1000)}s. This is retryable — the same sync run ` +
              'again later should find the account. ' +
              PROVISIONING_PROFILE_HINT,
          );
        }
        await this.sleep(wait);
        continue;
      }

      const created = (await response.json()) as { id?: string };
      if (!created?.id) {
        throw new Error(
          `MetaApi accepted the account for ${credentials.server} but returned no account id ` +
            `(HTTP ${response.status}).`,
        );
      }
      return created.id;
    }
  }

  /**
   * Waits until the account is both deployed and connected to the broker.
   *
   * Creating an account starts it, but starting is asynchronous: `account-information`
   * documents "404 — MetaTrader account not found or not provisioned yet" for the window in
   * between. The wait is bounded — each request already carries a 60s abort, and this bounds
   * the whole loop so a sync cannot hang on an account that never comes up.
   *
   * `deploy` is sent only when the account really is stopped. It is documented as "ignored if
   * the account is already deployed", so it is the remedy for an account that was undeployed
   * (by hand, or by a previous failure), not a second step every create needs.
   */
  private async waitUntilReady(accountId: string, deadline: number): Promise<void> {
    let deployRequested = false;
    let last: MetaApiAccount = {};

    for (;;) {
      last = await this.request<MetaApiAccount>(
        `${this.provisioningUrl}/users/current/accounts/${accountId}`,
      );

      if (last.state === 'DEPLOYED' && last.connectionStatus === 'CONNECTED') return;

      if (!deployRequested && last.state !== 'DEPLOYED' && last.state !== 'DEPLOYING') {
        deployRequested = true;
        await this.send(`${this.provisioningUrl}/users/current/accounts/${accountId}/deploy`, {
          method: 'POST',
        });
      }

      if (Date.now() + this.pollIntervalMs > deadline) {
        throw new Error(
          `MetaApi account ${accountId} was not ready within ` +
            `${Math.round(this.readyTimeoutMs / 1000)}s ` +
            `(state=${last.state ?? 'unknown'}, connectionStatus=${last.connectionStatus ?? 'unknown'}). ` +
            'Nothing has been lost — the account stays registered and the next sync resumes ' +
            'the wait.',
        );
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  /**
   * NOTE ON COST: several MetaApi errors — E_AUTH, E_SERVER_TIMEZONE, E_NO_SYMBOLS,
   * ERR_OTP_REQUIRED, E_PASSWORD_CHANGE_REQUIRED, E_TRADING_ACCOUNT_DISABLED — are billed
   * "for each excessive occurrence". This runs on a user-facing form with a rate limit in
   * front of it (see `connectMt5Action`) but no backoff or negative cache of its own, so a
   * client hammering a wrong password is a cost as well as an annoyance.
   */
  async verify(credentials: Mt5Credentials): Promise<Mt5VerifyResult> {
    try {
      const account = await this.fetchAccountState(credentials);
      return { ok: true, account };
    } catch (error) {
      if (error instanceof MetaApiError) {
        // Before the blanket 401/403 rule: a 403 is also how MetaApi says the *subscription*
        // is unpaid, and that has nothing to do with the password the user just typed.
        // Observed live: POST .../deploy answers 403 ForbiddenError "To allow trading account
        // deployment please top up your account." Reading that as invalid-credentials sends
        // the trader to re-check a password that was correct all along, while the account sits
        // UNDEPLOYED and every subsequent client call answers 504.
        if (error.isBillingProblem()) {
          return { ok: false, reason: 'unreachable', detail: error.message };
        }
        if (error.status === 401 || error.status === 403) {
          return { ok: false, reason: 'invalid-credentials' };
        }
        // The name is not one this broker publishes. Told apart from "we could not reach the
        // broker" because the two ask the user for completely different things: one is a typo
        // in a field, the other is "wait and try again".
        if (error.isUnknownServer()) {
          return {
            ok: false,
            reason: 'unknown-server',
            detail: `${error.message}. ${PROVISIONING_PROFILE_HINT}`,
            suggestions: error.serverSuggestions(),
          };
        }
        // The broker refused the login itself. MetaApi reports it as a validation error rather
        // than a 401, and telling the user "check the password" beats "try again later" —
        // retrying is exactly what makes this error expensive.
        const code = error.code();
        if (code === 'E_AUTH' || code === 'E_PASSWORD_CHANGE_REQUIRED') {
          return { ok: false, reason: 'invalid-credentials' };
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: 'unreachable', detail: message };
    }
  }

  async fetchAccountState(credentials: Mt5Credentials): Promise<Mt5AccountState> {
    const accountId = await this.resolveAccountId(credentials);
    const info = await this.request<{
      balance: number;
      equity: number;
      currency: string;
      name?: string;
    }>(`${this.clientUrl}/users/current/accounts/${accountId}/account-information`);

    return {
      login: credentials.login,
      server: credentials.server,
      currency: info.currency,
      balance: info.balance,
      equity: info.equity,
      name: info.name,
      // Handed back so the caller can store it and skip the lookup next time.
      providerAccountId: accountId,
    };
  }

  async fetchDeals(
    credentials: Mt5Credentials,
    options: FetchDealsOptions = {},
  ): Promise<Mt5Deal[]> {
    const accountId = await this.resolveAccountId(credentials);
    // No `since` means the first connect: pull the whole history. MT5 keeps it all, which is
    // what makes the backfill in SPEC §3.6 possible without touching the old journal.
    const from = (options.since ?? new Date('2000-01-01T00:00:00Z')).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const base = `${this.clientUrl}/users/current/accounts/${accountId}/history-deals/time/${from}/${to}`;

    // The endpoint is paginated and caps a page at 1000. Asking once and stopping — which is
    // what this used to do — silently truncates any account past its first 1000 deals to its
    // *earliest* 1000, which is a backfill that looks like it worked and is not.
    const deals: MetaApiDeal[] = [];
    for (let page = 0; page < DEALS_PAGE_LIMIT; page += 1) {
      const batch = await this.request<MetaApiDeal[]>(
        `${base}?offset=${deals.length}&limit=${DEALS_PAGE_SIZE}`,
      );
      deals.push(...batch);
      if (batch.length < DEALS_PAGE_SIZE) return aggregateDeals(deals);
    }

    throw new Error(
      `MetaApi returned more than ${DEALS_PAGE_LIMIT * DEALS_PAGE_SIZE} deals for this account; ` +
        'refusing to keep paging. Sync the account over a shorter period.',
    );
  }

  /**
   * Stops the terminal, so the meter drops to the idle rate.
   *
   * MetaApi bills $0.0126 an hour for a deployed account and $0.00105 for an undeployed one —
   * $9.20 a month against $0.77 — plus $0.0756 each time one is started. TRi reads a broker on
   * a button press and then does nothing for days, so the account is stopped when the sync is
   * done and started again by `waitUntilReady` on the next one.
   *
   * The break-even is arithmetic rather than opinion: a deployment costs the same as six hours
   * of running, so releasing wins below roughly four syncs a day and loses above it. That is
   * why `METAAPI_KEEP_DEPLOYED` exists — a desk that refreshes all day should keep the
   * terminal up, and the default suits a trader who looks in weekly.
   *
   * The waking cost is paid in seconds, not money: a freshly started terminal answers
   * "not connected to broker yet" for a minute or so, which is exactly what `waitUntilReady`
   * is there to sit through.
   *
   * Never throws. The account id is resolved from the cache when it is already known and this
   * is skipped entirely when it is not — a release is worth one request, and never worth
   * making the sync that just succeeded look like it failed.
   */
  async release(credentials: Mt5Credentials): Promise<void> {
    if (this.keepDeployed) return;

    /*
     * Forget it before stopping it.
     *
     * `resolveAccountId` memoises the whole provisioning handshake, readiness wait included,
     * so a second sync in the same process would take the remembered id and go straight to
     * the client API — against a terminal this method had just undeployed, which answers 404
     * and 504. The first sync worked, every one after it failed, and only a restart cleared
     * it. Dropping the entry means the next sync provisions and waits again, which is exactly
     * what an account that has been stopped needs.
     */
    this.resolved.delete(this.memoKey(credentials));

    try {
      const accountId = credentials.providerAccountId ?? (await this.resolveAccountId(credentials));
      await this.send(`${this.provisioningUrl}/users/current/accounts/${accountId}/undeploy`, {
        method: 'POST',
      });
    } catch (error) {
      console.warn(
        '[mt5] could not release the account; it stays deployed and billable:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async fetchSymbolSpecs(
    credentials: Mt5Credentials,
    symbols: string[],
  ): Promise<SymbolSpecOverride[]> {
    const accountId = await this.resolveAccountId(credentials);

    const specs = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          /*
           * `profitCurrency`, not `quoteCurrency`.
           *
           * MetaApi's symbol specification has no field called `quoteCurrency`. It carries
           * `baseCurrency`, `profitCurrency` and `marginCurrency`, and the one a price is
           * quoted in — the one `|entry − sl| × contractSize × volume` comes out in — is
           * `profitCurrency`. Reading a name that is not there returned `undefined`, and
           * TypeScript could not object because the shape is asserted on an untyped response.
           *
           * `contractSize` and `digits` are real fields, so the override arrived looking
           * healthy and poisoned only the currency. The effect was inverted and invisible:
           * when this call *succeeded* the override displaced the static table and every
           * risk on the account became `unconvertible`; when it 404'd the static table was
           * used and risk worked. One broker's symbol names survived normalisation and got
           * 200s — forty-one stopped trades, no risk. Another's were suffixed, 404'd, and
           * came out right.
           */
          const spec = await this.request<{
            symbol: string;
            contractSize: number;
            profitCurrency?: string;
            baseCurrency?: string;
            digits: number;
          }>(
            `${this.clientUrl}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/specification`,
          );
          return {
            symbol: spec.symbol,
            contractSize: spec.contractSize,
            quoteCurrency: spec.profitCurrency ?? '',
            baseCurrency: spec.baseCurrency,
            digits: spec.digits,
          } satisfies SymbolSpecOverride;
        } catch {
          // A symbol the broker no longer lists falls back to the static table, which may
          // mean no RR for it. Better than failing the whole sync.
          return null;
        }
      }),
    );

    return specs.filter((spec) => spec !== null);
  }
}

/** `Retry-After` is documented in seconds; a date form is accepted defensively. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.('retry-after');
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const at = Date.parse(header);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

/**
 * Folds MT5's deal stream into closed positions.
 *
 * MT5 records an entry deal and an exit deal against a shared `positionId`; the money is on
 * the exit, the entry price is on the entry. A position scaled out over several exits
 * produces more than two, so exits are summed rather than assumed unique.
 *
 * INTEGRATION NOTE: this is the part most likely to need adjustment against a real account —
 * partial closes, hedged positions and broker-specific `entryType` values all land here.
 * Exported so it can be tested against captured fixtures without a live connection.
 */
export function aggregateDeals(deals: MetaApiDeal[]): Mt5Deal[] {
  const byPosition = new Map<string, MetaApiDeal[]>();
  const result: Mt5Deal[] = [];

  for (const deal of deals) {
    // Deposits, withdrawals and corrections carry no position.
    if (deal.type === 'DEAL_TYPE_BALANCE' || deal.type === 'DEAL_TYPE_CREDIT') {
      const at = new Date(deal.time);
      result.push({
        ticket: deal.id,
        kind: deal.type === 'DEAL_TYPE_CREDIT' ? 'credit' : 'balance',
        symbol: '',
        direction: 'long',
        volume: 0,
        openAt: at,
        closeAt: at,
        entryPrice: 0,
        exitPrice: null,
        stopLoss: null,
        takeProfit: null,
        commission: deal.commission ?? 0,
        swap: deal.swap ?? 0,
        profit: deal.profit ?? 0,
      });
      continue;
    }

    if (!deal.positionId) continue;
    const bucket = byPosition.get(deal.positionId);
    if (bucket) bucket.push(deal);
    else byPosition.set(deal.positionId, [deal]);
  }

  for (const [positionId, group] of byPosition) {
    const ordered = [...group].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );
    const entries = ordered.filter((d) => d.entryType === 'DEAL_ENTRY_IN');
    const entry = entries[0] ?? ordered[0];
    const exits = ordered.filter((d) => d.entryType && d.entryType !== 'DEAL_ENTRY_IN');
    if (!entry || exits.length === 0) continue; // Still open — nothing to report yet.

    const last = exits[exits.length - 1]!;
    const sum = (pick: (d: MetaApiDeal) => number | undefined) =>
      ordered.reduce((total, d) => total + (pick(d) ?? 0), 0);

    /*
     * Scaling *in* is folded the same way scaling out already was.
     *
     * This used to take `entry.volume` and `entry.price` from the first entry deal alone,
     * which is right for the common case and silently wrong for a position built in
     * instalments: three half-lot entries were reported as half a lot at the first fill's
     * price. That is not only a cosmetic understatement of size — `computeRisk` multiplies
     * volume by the entry-to-stop distance, so the trade's risk came out at a third of what
     * was actually risked and its R multiple at three times what was actually earned. Both
     * feed the analytics, the RR coverage and now the risk-dispersion figure.
     *
     * The average is volume-weighted, which is what an average entry price means and what the
     * broker's own terminal shows. With one entry deal it is exactly the old behaviour.
     */
    const entryVolume = entries.reduce((total, d) => total + (d.volume ?? 0), 0) || entry.volume || 0;
    const weightedEntry =
      entryVolume > 0
        ? entries.reduce((total, d) => total + (d.price ?? 0) * (d.volume ?? 0), 0) / entryVolume
        : (entry.price ?? 0);

    result.push({
      ticket: positionId,
      kind: 'trade',
      symbol: normalizeSymbol(entry.symbol ?? ''),
      // An entry deal of type BUY is a long position; SELL is short.
      direction: entry.type === 'DEAL_TYPE_BUY' ? 'long' : 'short',
      volume: entryVolume,
      openAt: new Date(entry.time),
      closeAt: new Date(last.time),
      // Volume-weighted across every entry fill; `entries[0].price` when there was only one.
      entryPrice: entries.length > 0 ? weightedEntry : (entry.price ?? 0),
      exitPrice: last.price ?? null,
      // A stop loss removed before the close leaves no trace in the history; such a trade
      // ends up with no RR, and is counted against RR coverage rather than guessed at.
      stopLoss: entry.stopLoss ?? last.stopLoss ?? null,
      takeProfit: entry.takeProfit ?? last.takeProfit ?? null,
      commission: sum((d) => d.commission),
      swap: sum((d) => d.swap),
      profit: sum((d) => d.profit),
    });
  }

  return result.sort((a, b) => (a.closeAt?.getTime() ?? 0) - (b.closeAt?.getTime() ?? 0));
}
