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
};

export type Mt5Credentials = {
  login: string;
  server: string;
  /** The **investor** (read-only) password. Never the master password. */
  investorPassword: string;
};

export type Mt5VerifyResult =
  | { ok: true; account: Mt5AccountState }
  | { ok: false; reason: 'invalid-credentials' | 'unreachable' | 'unsupported'; detail?: string };

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
   * Rates needed to express risk in the account currency when a symbol is quoted in a third
   * currency (GER40 in euros on a dollar account). Keyed `"<quote><account>"`.
   */
  fetchQuoteRates?(credentials: Mt5Credentials, pairs: string[]): Promise<Record<string, number>>;
}

export type SymbolSpecOverride = {
  symbol: string;
  contractSize: number;
  quoteCurrency: string;
  digits: number;
};
