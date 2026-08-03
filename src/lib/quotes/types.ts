/**
 * The market-data port.
 *
 * Two questions, which is all this feature needs: *what is this thing called* (search, for
 * the add-position form) and *what is it worth* (quotes, for the refresh). Nothing above this
 * line knows whether the answers came from a vendor or from the deterministic mock — the same
 * arrangement `Mt5Provider` uses, and for the same reason: the test suite has to run with no
 * network and give the same answer every time.
 *
 * Read-only by construction, like the MT5 port. Nothing here can place an order or spend
 * anything but an API credit.
 */

import type { AssetKind } from './market';

/** One listing, as the search returns it. */
export type SymbolMatch = {
  /** `AAPL`, or `BTC/USD` for a crypto pair. */
  symbol: string;
  /** `Apple Inc.` — what the user actually typed to find it. */
  name: string;
  /** `NASDAQ`. Shown to the user; the MIC is what gets stored. */
  exchange: string;
  /** `XNGS`. Empty for crypto. Together with `symbol` this identifies a price. */
  micCode: string;
  /** ISO-4217 code the listing is quoted in. */
  currency: string;
  kind: AssetKind;
};

/** What identifies a price: a ticker on a particular listing. */
export type QuoteKey = {
  symbol: string;
  micCode: string;
};

export type Quote = QuoteKey & {
  price: number;
  currency: string;
  /** The instant the market produced this price. */
  asOf: Date;
};

export interface QuoteProvider {
  readonly name: 'mock' | 'twelvedata';

  /**
   * Matches on company name *and* ticker — "apple" and "AAPL" both have to find Apple, which
   * is the half of this feature a user touches directly.
   */
  search(query: string, limit: number): Promise<SymbolMatch[]>;

  /**
   * One call for the whole batch. Listings the provider cannot price are simply absent from
   * the result rather than throwing: one delisted ticker must not cost the other ninety-nine
   * their refresh.
   */
  fetchQuotes(keys: readonly QuoteKey[]): Promise<Quote[]>;
}

/** `symbol@mic` — the map key used wherever quotes are matched back to positions. */
export function quoteKeyOf(key: QuoteKey): string {
  return `${key.symbol}@${key.micCode}`;
}
