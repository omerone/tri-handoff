import { assetKind } from '../market';
import {
  quoteKeyOf,
  type Quote,
  type QuoteKey,
  type QuoteProvider,
  type SymbolMatch,
} from '../types';

/**
 * The offline provider: a small catalogue and a deterministic price.
 *
 * `QUOTES_PROVIDER=mock` is the default, which matters more here than it does for MT5. The
 * end-to-end suite loads the long-positions screen on every run, and a test that reaches a
 * vendor's API is a test that fails on a train, spends real credits, and changes its answer
 * every afternoon.
 *
 * Prices are derived from the symbol rather than drawn at random: the same ticker is worth
 * the same on every run, so a test can assert on a number.
 */

const CATALOGUE: SymbolMatch[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', micCode: 'XNGS', currency: 'USD', kind: 'equity' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', micCode: 'XNGS', currency: 'USD', kind: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', micCode: 'XNGS', currency: 'USD', kind: 'equity' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', micCode: 'XNGS', currency: 'USD', kind: 'equity' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust, Series 1', exchange: 'NASDAQ', micCode: 'XNMS', currency: 'USD', kind: 'equity' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE', micCode: 'ARCX', currency: 'USD', kind: 'equity' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', exchange: 'NYSE', micCode: 'ARCX', currency: 'USD', kind: 'equity' },
  // The same ticker on a second listing, in another currency — the case the MIC column
  // exists for, and one the tests need a real example of.
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'LSE', micCode: 'XLON', currency: 'GBP', kind: 'equity' },
  { symbol: 'BTC/USD', name: 'Bitcoin', exchange: 'Coinbase Pro', micCode: '', currency: 'USD', kind: 'crypto' },
  { symbol: 'ETH/USD', name: 'Ethereum', exchange: 'Coinbase Pro', micCode: '', currency: 'USD', kind: 'crypto' },
];

/** Stable pseudo-price: the same listing always produces the same number. */
function mockPrice(symbol: string, micCode: string): number {
  let hash = 0;
  for (const char of `${symbol}${micCode}`) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  const base = assetKind(symbol) === 'crypto' ? 60_000 : 100;
  return Math.round((base + (hash % (base * 2))) * 100) / 100;
}

export class MockQuoteProvider implements QuoteProvider {
  readonly name = 'mock' as const;

  async search(query: string, limit: number): Promise<SymbolMatch[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    // Ticker matches first: someone who typed "QQQ" wants the fund, not every company whose
    // name happens to contain those letters.
    const byTicker = CATALOGUE.filter((row) => row.symbol.toLowerCase().startsWith(needle));
    const byName = CATALOGUE.filter(
      (row) => !byTicker.includes(row) && row.name.toLowerCase().includes(needle),
    );
    return [...byTicker, ...byName].slice(0, limit);
  }

  async fetchQuotes(keys: readonly QuoteKey[]): Promise<Quote[]> {
    const known = new Map(CATALOGUE.map((row) => [quoteKeyOf(row), row] as const));
    // Reversed so the *first* listing of a ticker wins the key — the primary one, which is
    // what a bare symbol asks for.
    const primary = new Map([...CATALOGUE].reverse().map((row) => [row.symbol, row] as const));
    const asOf = new Date();
    return keys.flatMap((key): Quote[] => {
      // An empty MIC asks for the primary listing — a crypto pair, or a position that predates
      // the search box. Mirrors what the real vendor does with a bare ticker.
      const listing = known.get(quoteKeyOf(key)) ?? (key.micCode === '' ? primary.get(key.symbol) : undefined);
      // An unknown listing is dropped, exactly as a real provider drops it — the refresh has
      // to cope with getting fewer quotes back than it asked for.
      if (!listing) return [];
      return [
        {
          symbol: key.symbol,
          micCode: key.micCode,
          price: mockPrice(key.symbol, listing.micCode),
          currency: listing.currency,
          asOf,
        },
      ];
    });
  }
}
