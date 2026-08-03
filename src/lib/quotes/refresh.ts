import 'server-only';
import {
  applyQuoteToPositions,
  listTrackedSymbols,
  readQuotes,
  touchQuoteAttempt,
  writeQuote,
  type TrackedSymbol,
} from '@/lib/db/quotes';
import { consumeRateLimit } from '@/lib/db/rate-limit';
import { env } from '@/lib/env';
import { needsRefresh } from './market';
import { quotesProvider } from './index';
import { quoteKeyOf } from './types';

/**
 * The refresh.
 *
 * Runs on a timer (see `src/instrumentation-node.ts`), a chunk at a time, and is the only
 * thing in the app that spends API credits. Three limits sit between it and the vendor's
 * daily allowance, and they answer different failure modes:
 *
 *   1. `needsRefresh` — never ask about a price that cannot have changed. This is what makes
 *      a hundred symbols cost a hundred credits a day instead of thousands.
 *   2. `CHUNK` — the free plan meters credits per *minute*, and a batch of a hundred symbols
 *      is a hundred credits in one instant. Eight per tick is that allowance, so a full
 *      portfolio drips through in about a quarter of an hour.
 *   3. the daily budget — a hard stop that does not depend on the other two being right. Any
 *      bug that makes symbols look permanently stale burns credits until this catches it, and
 *      then the worst case is a price that arrives tomorrow instead of tonight.
 *
 * Every failure is a no-op rather than an exception: the cache already holds the last good
 * price, and a feed being down must never show up as anything worse than a date that has
 * stopped moving.
 */

/** Listings per tick — the free plan's per-minute credit allowance. */
export const CHUNK = 8;

/** Fixed 24-hour window; a rolling one would let a single burst straddle two of them. */
const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const BUDGET_KEY = 'quotes:daily';

export type RefreshOutcome = {
  /** Listings that were owed a fetch when the tick started. */
  due: number;
  /** Listings actually asked about this tick. */
  requested: number;
  /** Quotes that came back and were written. */
  updated: number;
  /** Positions marked to a new price. */
  positions: number;
  /** True when the daily budget cut the tick short. */
  budgetSpent: boolean;
};

const EMPTY: RefreshOutcome = {
  due: 0,
  requested: 0,
  updated: 0,
  positions: 0,
  budgetSpent: false,
};

/** Listings that are owed a price right now. */
export async function dueSymbols(now: Date): Promise<TrackedSymbol[]> {
  const tracked = await listTrackedSymbols();
  if (tracked.length === 0) return [];

  const rows = await readQuotes(tracked);
  const cached = new Map(
    rows.map((row) => [quoteKeyOf(row), { asOf: row.asOf, fetchedAt: row.fetchedAt }] as const),
  );

  return tracked.filter((key) => needsRefresh(cached.get(quoteKeyOf(key)) ?? null, key.symbol, now));
}

/**
 * One tick: refresh up to `CHUNK` listings that are due.
 *
 * `limit` lets a caller ask for a smaller slice. Nothing may ask for a larger one — the
 * per-minute meter belongs to the vendor, not to us.
 */
export async function refreshDueQuotes(
  now: Date = new Date(),
  limit: number = CHUNK,
): Promise<RefreshOutcome> {
  const due = await dueSymbols(now);
  if (due.length === 0) return EMPTY;

  const wanted = due.slice(0, Math.max(0, Math.min(limit, CHUNK)));
  const budget = env().QUOTES_DAILY_BUDGET;

  // One credit reserved per listing, before the request goes out. Reserving afterwards would
  // let a crash between the call and the write spend credits the counter never hears about.
  const affordable: TrackedSymbol[] = [];
  let budgetSpent = false;
  for (const key of wanted) {
    const verdict = await consumeRateLimit(BUDGET_KEY, budget, BUDGET_WINDOW_MS);
    if (!verdict.allowed) {
      budgetSpent = true;
      break;
    }
    affordable.push(key);
  }

  if (affordable.length === 0) return { ...EMPTY, due: due.length, budgetSpent };

  const quotes = await quotesProvider().fetchQuotes(affordable);
  const returned = new Set(quotes.map(quoteKeyOf));

  let updated = 0;
  let positions = 0;
  for (const quote of quotes) {
    await writeQuote(quote);
    positions += await applyQuoteToPositions(quote);
    updated += 1;
  }

  // Listings the provider had nothing for: back them off, so an unlisted ticker does not take
  // a slot on every tick from now until the end of time.
  for (const key of affordable) {
    if (!returned.has(quoteKeyOf(key))) await touchQuoteAttempt(key.symbol, key.micCode);
  }

  return { due: due.length, requested: affordable.length, updated, positions, budgetSpent };
}
