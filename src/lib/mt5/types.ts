/**
 * The MT5 port.
 *
 * Everything above this line works with `Mt5Deal`; nothing above it knows whether the deals
 * came from MetaApi's cloud or the deterministic mock. `MT5_PROVIDER` picks the
 * implementation (see ./index.ts).
 *
 * The interface is read-only by construction — there is no place to put an order. SPEC §5
 * makes that a product decision, and it is why the investor (read-only) password is enough.
 */

/**
 * How many broker accounts one trader may connect.
 *
 * Two, because that is what the product offers and says on the screen: a day account and a
 * swing account, kept as separate books. Enforced in `src/lib/db/mt5-accounts.ts` as well as
 * drawn on the settings screen — a limit that only exists in the markup is a limit until the
 * first person opens two tabs, and each account past the first is a real monthly charge on
 * somebody's card.
 *
 * It lives here rather than beside the check, because the settings card draws one slot per
 * account and that card is a client component. Importing the number from the repository
 * pulled `server-only` into the browser bundle and the build refused it outright — correctly:
 * a module that reaches Prisma has no business being resolvable from the client, and one
 * shared constant is not a reason to make it so. This file is the vocabulary both sides
 * already share and it has no server dependency of its own.
 */
export const MAX_MT5_ACCOUNTS = 2;

export type AssetClass = 'forex' | 'crypto' | 'indices' | 'stocks' | 'commodities' | 'other';
export type Direction = 'long' | 'short';
export type TradeStyle = 'day' | 'swing';

/**
 * Deals that move the balance without being a market position. MT5 reports deposits,
 * withdrawals and corrections in the same history stream as trades; they are stored (SPEC
 * §3.2 wants the cash flow) and excluded from every performance metric.
 */
export type DealKind = 'trade' | 'balance' | 'credit' | 'correction';

/**
 * One closed position, normalised.
 *
 * Prices, not derived metrics: `risk` and `rr` are computed by TRi from these plus the
 * symbol spec, so the same rule applies to every provider and there is one place to audit.
 */
export type Mt5Deal = {
  /** Broker-side identifier. Unique per account; the idempotency key for sync. */
  ticket: string;
  kind: DealKind;
  symbol: string;
  direction: Direction;
  /** Lots. */
  volume: number;
  openAt: Date;
  closeAt: Date | null;
  entryPrice: number;
  exitPrice: number | null;
  /** Null when the position carried no stop loss — the reason a trade has no RR. */
  stopLoss: number | null;
  takeProfit: number | null;
  /** Broker charges, as MT5 reports them: negative when they cost the trader. */
  commission: number;
  swap: number;
  /** Gross result in the account currency, before commission and swap. */
  profit: number;
};

export type Mt5AccountState = {
  login: string;
  server: string;
  /** ISO-4217 code the account is denominated in — what `profit` and `risk` are measured in. */
  currency: string;
  balance: number;
  equity: number;
  /** Broker-declared name, when the provider knows it. */
  name?: string;
  /**
   * The provider's own id for this account, when it has one.
   *
   * Returned so the caller can store it on `mt5_accounts.provider_account_id` and hand it back
   * as `Mt5Credentials.providerAccountId` — see the note there.
   */
  providerAccountId?: string;
};

export type Mt5Credentials = {
  login: string;
  server: string;
  /** The **investor** (read-only) password. Never the master password. */
  investorPassword: string;
  /**
   * Which TRi user these credentials belong to — the tenant boundary, carried into the broker.
   *
   * Every client's MT5 account is registered under one shared MetaApi subscription, so the
   * provider's own account list is a namespace all our users share. Looking an account up by
   * login and server alone therefore hands the first user's account to the second user who
   * types the same numbers, and an MT5 login is eight digits and a server name is public: the
   * lookup would authenticate nobody while returning somebody's balance and their whole
   * history. Registering under a name that carries this key means each user only ever finds
   * the account they themselves provisioned, and anyone else's wrong password is rejected by
   * the broker where it should be.
   *
   * Required, not optional, so a new call site cannot omit it and quietly reopen that door.
   */
  accountKey: string;
  /**
   * The provider's id for this account, if one has already been stored.
   *
   * Optional and purely a shortcut: MetaApi registers an account under an id of its own, and
   * finding that id means listing every account on the subscription. Once it is known it is
   * kept on `mt5_accounts.provider_account_id`, and passing it back here turns three lookups
   * per sync into none. A provider that has no such concept ignores it.
   */
  providerAccountId?: string | null;
};

export type Mt5VerifyResult =
  | { ok: true; account: Mt5AccountState }
  | {
      ok: false;
      reason: 'invalid-credentials' | 'unknown-server' | 'unreachable' | 'unsupported';
      detail?: string;
      /**
       * Server names the provider recognised as close to the one that was typed.
       *
       * `unknown-server` is the most likely first failure and the least self-explanatory:
       * every broker names its servers its own way — `FTMO-Server4`, `ICMarketsSC-MT5` — and a
       * trader who mistypes one gets told only that something is wrong. MetaApi answers an
       * unrecognised name with the near matches from the broker it did detect, so the wizard
       * can ask "did you mean this?" instead of leaving them to guess.
       */
      suggestions?: string[];
    };

export type FetchDealsOptions = {
  /**
   * Only deals closed at or after this instant. Omitted on the first connect, which is the
   * full historical backfill SPEC §3.6 relies on — MT5 keeps the whole account history, so
   * everything the trader sees in their old journal is recoverable from the broker.
   */
  since?: Date;
};

/**
 * What a provider must be able to do. Deliberately small: connect, prove the credentials
 * work, read the account, read the deals.
 */
export interface Mt5Provider {
  readonly name: 'mock' | 'metaapi';

  /** Checks the credentials and returns the account state, without storing anything. */
  verify(credentials: Mt5Credentials): Promise<Mt5VerifyResult>;

  fetchAccountState(credentials: Mt5Credentials): Promise<Mt5AccountState>;

  fetchDeals(credentials: Mt5Credentials, options?: FetchDealsOptions): Promise<Mt5Deal[]>;

  /**
   * Broker-side contract specifications for the symbols in a set of deals. The static table
   * in ./symbols.ts is the fallback; a real broker's own numbers win when available.
   */
  fetchSymbolSpecs?(credentials: Mt5Credentials, symbols: string[]): Promise<SymbolSpecOverride[]>;

  /**
   * Stop paying for a terminal nobody is reading.
   *
   * A metered provider charges by the hour the account is *running*, not by the request. TRi
   * reads a broker on login and on a button press and then does nothing for days, so leaving
   * the terminal up is renting a machine to sit idle: on MetaApi's own rates that is $0.0126
   * an hour against $0.00105 for a stopped account — $9.20 a month rather than $0.77.
   *
   * Optional, because it only means anything to a provider that bills this way. The mock has
   * nothing to release and does not implement it. Called after a sync finishes and never
   * allowed to fail one: releasing is an economy, and a failed economy is not a failed sync.
   */
  release?(credentials: Mt5Credentials): Promise<void>;

  /**
   * Rates needed to express risk in the account currency when a symbol is quoted in a third
   * currency (GER40 in euros on a dollar account). Keyed `"<quote><account>"`.
   */
  fetchQuoteRates?(credentials: Mt5Credentials, pairs: string[]): Promise<Record<string, number>>;

  /**
   * Price history covering a window, for computing MAE and MFE.
   *
   * Optional, and the sync treats its absence as "those two columns stay null" rather than as
   * an error: a provider that cannot supply candles is a provider whose trades have unknown
   * excursions, which is a fact the UI can state. It must never be the reason a sync fails —
   * the trades themselves do not depend on it.
   */
  fetchBars?(
    credentials: Mt5Credentials,
    request: { symbol: string; from: Date; to: Date },
  ): Promise<PriceBar[]>;
}

/**
 * One candle. Only the two extremes are used — the excursion is about how far price reached,
 * not where it settled — but open and close come along because every provider returns them
 * and a bar with only a high and a low is hard to sanity-check against a chart.
 */
export type PriceBar = {
  at: Date;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SymbolSpecOverride = {
  symbol: string;
  contractSize: number;
  quoteCurrency: string;
  digits: number;
};
