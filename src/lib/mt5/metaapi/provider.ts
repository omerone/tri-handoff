import 'server-only';
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
 * broker account. The shapes below follow MetaApi's documented history-deal format. Treat the
 * first live connection as an integration task: the two things most likely to need adjusting
 * are the deal→position aggregation and the provisioning step, both marked below.
 */

const DEFAULT_REGION = 'new-york';

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

  isUnknownServer(): boolean {
    const record = this.body as { id?: unknown; code?: unknown } | null;
    if (record && (record.id === 'E_SRV_NOT_FOUND' || record.code === 'E_SRV_NOT_FOUND')) {
      return true;
    }
    // MetaApi has not always used a machine-readable code here; the sentence is stable.
    return /\.dat file for server|please check the server name/i.test(this.message);
  }

  /**
   * The near-miss server names MetaApi returns alongside the error.
   *
   * Read from a couple of shapes because the field has moved between versions of the API, and
   * an empty list is a perfectly good answer — the wizard simply asks the user to check the
   * name themselves.
   */
  serverSuggestions(): string[] {
    const record = this.body as Record<string, unknown> | null;
    const candidates = [record?.metadata, record?.details, record]
      .map((value) =>
        value && typeof value === 'object'
          ? (value as Record<string, unknown>).recommendedServers ??
            (value as Record<string, unknown>).similarServerNames ??
            (value as Record<string, unknown>).servers
          : undefined,
      )
      .find(Array.isArray);

    return Array.isArray(candidates)
      ? candidates.filter((name): name is string => typeof name === 'string').slice(0, 5)
      : [];
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

export class MetaApiProvider implements Mt5Provider {
  readonly name = 'metaapi' as const;

  constructor(
    private readonly token: string,
    private readonly region: string = DEFAULT_REGION,
  ) {}

  private get provisioningUrl(): string {
    return 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
  }

  private get clientUrl(): string {
    return `https://mt-client-api-v1.${this.region}.agiliumtrade.ai`;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
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
    return (await response.json()) as T;
  }

  /**
   * MetaApi requires the account to be registered with them before it can be read. The id is
   * cached on `mt5_accounts.provider_account_id` so this happens once per client.
   *
   * INTEGRATION NOTE: deployment is asynchronous — a freshly created account reports
   * `DEPLOYING` for a minute or so. The sync treats that as a retryable failure rather than
   * blocking the user's login.
   */
  private async resolveAccountId(credentials: Mt5Credentials): Promise<string> {
    const existing = await this.request<{ _id: string; login: string }[]>(
      `${this.provisioningUrl}/users/current/accounts`,
    );
    const match = existing.find((account) => account.login === credentials.login);
    if (match) return match._id;

    const created = await this.request<{ id: string }>(
      `${this.provisioningUrl}/users/current/accounts`,
      {
        method: 'POST',
        body: JSON.stringify({
          login: credentials.login,
          // Read-only by construction: MetaApi's own term for an investor connection.
          password: credentials.investorPassword,
          name: `tri-${credentials.login}`,
          server: credentials.server,
          platform: 'mt5',
          magic: 0,
          type: 'cloud',
        }),
      },
    );
    return created.id;
  }

  async verify(credentials: Mt5Credentials): Promise<Mt5VerifyResult> {
    try {
      const account = await this.fetchAccountState(credentials);
      return { ok: true, account };
    } catch (error) {
      if (error instanceof MetaApiError) {
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
            detail: error.message,
            suggestions: error.serverSuggestions(),
          };
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

    const deals = await this.request<MetaApiDeal[]>(
      `${this.clientUrl}/users/current/accounts/${accountId}/history-deals/time/${from}/${to}`,
    );

    return aggregateDeals(deals);
  }

  async fetchSymbolSpecs(
    credentials: Mt5Credentials,
    symbols: string[],
  ): Promise<SymbolSpecOverride[]> {
    const accountId = await this.resolveAccountId(credentials);

    const specs = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const spec = await this.request<{
            symbol: string;
            contractSize: number;
            quoteCurrency: string;
            digits: number;
          }>(
            `${this.clientUrl}/users/current/accounts/${accountId}/symbols/${encodeURIComponent(symbol)}/specification`,
          );
          return {
            symbol: spec.symbol,
            contractSize: spec.contractSize,
            quoteCurrency: spec.quoteCurrency,
            digits: spec.digits,
          } satisfies SymbolSpecOverride;
        } catch {
          // A symbol the broker no longer lists falls back to the static table, which may
          // mean no RR for it. Better than failing the whole sync.
          return null;
        }
      }),
    );

    return specs.filter((spec): spec is SymbolSpecOverride => spec !== null);
  }
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
    const entry = ordered.find((d) => d.entryType === 'DEAL_ENTRY_IN') ?? ordered[0];
    const exits = ordered.filter((d) => d.entryType && d.entryType !== 'DEAL_ENTRY_IN');
    if (!entry || exits.length === 0) continue; // Still open — nothing to report yet.

    const last = exits[exits.length - 1]!;
    const sum = (pick: (d: MetaApiDeal) => number | undefined) =>
      ordered.reduce((total, d) => total + (pick(d) ?? 0), 0);

    result.push({
      ticket: positionId,
      kind: 'trade',
      symbol: normalizeSymbol(entry.symbol ?? ''),
      // An entry deal of type BUY is a long position; SELL is short.
      direction: entry.type === 'DEAL_TYPE_BUY' ? 'long' : 'short',
      volume: entry.volume ?? 0,
      openAt: new Date(entry.time),
      closeAt: new Date(last.time),
      entryPrice: entry.price ?? 0,
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
