import 'server-only';
import { prisma } from './prisma';

/**
 * The market-price cache, and the positions that track it.
 *
 * Not tenant-scoped, and deliberately so: a quote is a fact about a listing, not about a
 * client, and sharing the row is what keeps a hundred-symbol portfolio inside a free API
 * budget. Nothing here can read a position's *contents* — the only thing it learns from
 * `long_positions` is which listings someone, somewhere, is tracking.
 */

export type TrackedSymbol = { symbol: string; micCode: string };

export type CachedQuoteRow = TrackedSymbol & {
  /** Null when the last attempt came back with nothing for this listing. */
  price: number | null;
  currency: string | null;
  asOf: Date | null;
  fetchedAt: Date;
};

/**
 * Every listing an open, auto-priced position is tracking.
 *
 * Distinct across all users: two clients holding Apple are one credit, not two. Closed
 * positions are excluded — their price is a historical fact and must never move again.
 */
export async function listTrackedSymbols(): Promise<TrackedSymbol[]> {
  const rows = await prisma.longPosition.findMany({
    where: { closedAt: null, priceSource: 'auto' },
    select: { symbol: true, micCode: true },
    distinct: ['symbol', 'micCode'],
    orderBy: [{ symbol: 'asc' }, { micCode: 'asc' }],
  });
  return rows.map((row) => ({ symbol: row.symbol, micCode: row.micCode }));
}

export async function readQuotes(keys: readonly TrackedSymbol[]): Promise<CachedQuoteRow[]> {
  if (keys.length === 0) return [];
  const rows = await prisma.quote.findMany({
    where: { OR: keys.map((key) => ({ symbol: key.symbol, micCode: key.micCode })) },
  });
  return rows.map((row) => ({
    symbol: row.symbol,
    micCode: row.micCode,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    asOf: row.asOf,
    fetchedAt: row.fetchedAt,
  }));
}

export async function writeQuote(quote: {
  symbol: string;
  micCode: string;
  price: number;
  currency: string;
  asOf: Date;
}): Promise<void> {
  await prisma.quote.upsert({
    where: { symbol_micCode: { symbol: quote.symbol, micCode: quote.micCode } },
    create: quote,
    update: {
      price: quote.price,
      currency: quote.currency,
      asOf: quote.asOf,
      fetchedAt: new Date(),
    },
  });
}

/**
 * Records that a listing was asked about and produced nothing.
 *
 * Without this, a ticker the vendor does not carry is retried on every tick forever. Stamping
 * `fetchedAt` puts it behind the same back-off as everything else; the price and its date are
 * left exactly as they were, so a feed that goes quiet does not erase what it said last time.
 */
export async function touchQuoteAttempt(symbol: string, micCode: string): Promise<void> {
  await prisma.quote.upsert({
    where: { symbol_micCode: { symbol, micCode } },
    create: { symbol, micCode },
    update: { fetchedAt: new Date() },
  });
}

/**
 * Marks every open auto-priced position in a listing to the new price.
 *
 * Scoped by currency as well as by listing: a position recorded in GBP must not be marked to
 * a price quoted in USD. That mismatch is silent in a way a wrong number never is — the value
 * would simply be off by the exchange rate and look entirely plausible.
 *
 * Returns how many positions moved, which is what the refresh logs.
 */
export async function applyQuoteToPositions(quote: {
  symbol: string;
  micCode: string;
  price: number;
  currency: string;
  asOf: Date;
}): Promise<number> {
  const { count } = await prisma.longPosition.updateMany({
    where: {
      symbol: quote.symbol,
      micCode: quote.micCode,
      currency: quote.currency,
      priceSource: 'auto',
      closedAt: null,
    },
    data: { currentPrice: quote.price, valueUpdatedAt: quote.asOf },
  });
  return count;
}
