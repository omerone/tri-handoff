/**
 * When a price is worth re-fetching.
 *
 * This is the whole cost model of the feature. The free tier grants 800 API credits a day
 * and one credit buys one symbol, so a hundred-symbol portfolio can afford eight full
 * refreshes a day and no more. Refreshing "every fifteen minutes" — the reflex — would want
 * 2,600 and get cut off before lunch.
 *
 * The rule that fits both the budget and the product: **one price per trading day, taken
 * after the close.** A long-term holding is not a day trade; the number a trader wants when
 * they open the app is the last close, and between one close and the next there is nothing
 * new to fetch. That costs one credit per symbol per trading day — a hundred symbols is an
 * eighth of the daily budget — and it means a weekend, a holiday, or a night of repeated
 * logins costs nothing at all.
 *
 * Crypto is the exception written into the rule: it never closes, so it gets a plain age
 * limit instead.
 *
 * Pure: no I/O, no clock beyond what is passed in.
 */

import { fromWallClock, wallClock } from '@/lib/time/zone';

export type AssetKind = 'equity' | 'crypto';

/** Where the US listings this app quotes actually trade. */
export const MARKET_TIME_ZONE = 'America/New_York';

/** Regular session, in the market's own wall clock. */
const CLOSE_HOUR = 16;
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;

/**
 * How old a crypto price may be.
 *
 * Six hours rather than minutes: this buys four refreshes a day for a handful of pairs, which
 * is noise against the budget, and a long-term position is not managed off a six-hour-old
 * bitcoin price. It also means an app left running overnight does not spend the morning's
 * credits on a coin nobody is watching.
 */
export const CRYPTO_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * The floor on how often one listing may be asked about, whatever the other rules say.
 *
 * The case it exists for is a market holiday. The weekday test below says Monday is a trading
 * day; on Thanksgiving the feed keeps answering with Wednesday's close, so `asOf` never
 * reaches "after the last close" and the symbol looks permanently stale. Without a floor that
 * is a fetch every tick, all day, for every symbol — the exact runaway the budget cannot
 * absorb. Holidays are not hard-coded because a calendar that has to be maintained by hand is
 * a calendar that will be wrong.
 */
export const MIN_REFETCH_MS = 60 * 60 * 1000;

/** Crypto pairs are written `BTC/USD`; no listed equity has a slash in its ticker. */
export function assetKind(symbol: string): AssetKind {
  return symbol.includes('/') ? 'crypto' : 'equity';
}

/** Saturday and Sunday in the market's zone. Holidays are handled by `MIN_REFETCH_MS`. */
function isWeekend(wall: { weekday: number }): boolean {
  return wall.weekday === 0 || wall.weekday === 6;
}

/**
 * The most recent regular-session close at or before `now`.
 *
 * Walks back a day at a time through the market's own calendar rather than doing arithmetic
 * on UTC: the offset changes twice a year, and on those two days a fixed-offset calculation
 * puts the close an hour out — which on a Sunday evening is the difference between "fresh"
 * and a hundred needless credits.
 */
export function lastMarketClose(now: Date, timeZone: string = MARKET_TIME_ZONE): Date {
  const wall = wallClock(now, timeZone);
  const closeToday = fromWallClock(
    { year: wall.year, month: wall.month, day: wall.day, hour: CLOSE_HOUR, minute: 0 },
    timeZone,
  );

  // Today's close counts only once it has happened, and only if today trades at all.
  let candidate = !isWeekend(wall) && now.getTime() >= closeToday.getTime() ? closeToday : null;

  for (let back = 1; candidate === null && back <= 7; back += 1) {
    const earlier = new Date(now.getTime() - back * 86_400_000);
    const day = wallClock(earlier, timeZone);
    if (isWeekend(day)) continue;
    candidate = fromWallClock(
      { year: day.year, month: day.month, day: day.day, hour: CLOSE_HOUR, minute: 0 },
      timeZone,
    );
  }

  // Unreachable — seven consecutive non-trading days do not exist — but returning null here
  // would read as "never stale" and quietly freeze every price on the screen.
  return candidate ?? new Date(now.getTime() - 7 * 86_400_000);
}

/** True during the regular session, which is the only time an intraday price differs. */
export function isMarketOpen(now: Date, timeZone: string = MARKET_TIME_ZONE): boolean {
  const wall = wallClock(now, timeZone);
  if (isWeekend(wall)) return false;
  const minutes = wall.hour * 60 + wall.minute;
  return minutes >= OPEN_HOUR * 60 + OPEN_MINUTE && minutes < CLOSE_HOUR * 60;
}

export type CachedQuote = {
  /** When the market produced the price. Null when the last attempt returned nothing. */
  asOf: Date | null;
  /** When we last asked the provider — not the same thing, and both are needed. */
  fetchedAt: Date;
};

/**
 * Whether a listing is owed a fetch.
 *
 * `null` means nothing is cached at all — a position added a minute ago — and that always
 * fetches: a new holding showing no price is the one case worth spending a credit on
 * immediately.
 */
export function needsRefresh(
  cached: CachedQuote | null,
  symbol: string,
  now: Date,
  timeZone: string = MARKET_TIME_ZONE,
): boolean {
  if (cached === null) return true;

  // Asked too recently. Checked first, so it holds however stale the price looks.
  if (now.getTime() - cached.fetchedAt.getTime() < MIN_REFETCH_MS) return false;

  // Asked before and the provider had nothing. Retried, but only at the back-off above — a
  // ticker it has never heard of must not eat a slot on every tick.
  if (cached.asOf === null) return true;

  if (assetKind(symbol) === 'crypto') {
    return now.getTime() - cached.asOf.getTime() >= CRYPTO_MAX_AGE_MS;
  }

  // An equity price is current from the close it was taken at until the next one.
  return cached.asOf.getTime() < lastMarketClose(now, timeZone).getTime();
}

/**
 * A price the user should be warned about, as opposed to one that is merely not from today.
 *
 * A Friday close read on a Sunday is not stale — the market has not traded since. This is
 * "the feed has stopped answering", which is a different message and a much rarer one.
 */
export function isQuoteStale(
  cached: CachedQuote,
  symbol: string,
  now: Date,
  timeZone: string = MARKET_TIME_ZONE,
): boolean {
  if (cached.asOf === null) return true;
  if (assetKind(symbol) === 'crypto') {
    return now.getTime() - cached.asOf.getTime() >= 2 * CRYPTO_MAX_AGE_MS;
  }
  // Missing the *previous* close as well means a whole trading day went by without an
  // answer, which no ordinary weekend or holiday explains.
  const lastClose = lastMarketClose(now, timeZone);
  const previousClose = lastMarketClose(new Date(lastClose.getTime() - 1000), timeZone);
  return cached.asOf.getTime() < previousClose.getTime();
}
