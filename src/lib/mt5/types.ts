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
