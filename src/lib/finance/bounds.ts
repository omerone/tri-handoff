/**
 * Date and month bounds for anything a user can type or put in a query string.
 *
 * Not defensive tidying. Finance dates feed month-by-month navigation and, before it was
 * rewritten, a month-by-month accumulation — so an entry dated in the year 1 combined with
 * `?m=2999-12` was a denial of service against every tenant, not just the one who typed it.
 * The accumulation no longer iterates, but the bounds stay: a date outside this window is a
 * typo in every real case, and accepting it only creates room for the next version of that
 * bug.
 *
 * Pure and shared, so the server action, the query parser and the UI all agree on the range.
 */

/** Nothing before this is a plausible personal-finance record. */
export const MIN_YEAR = 1970;
/** Far enough ahead for a scheduled entry, near enough to reject a fat-fingered year. */
export const MAX_YEAR_AHEAD = 5;

export function maxYear(now: Date = new Date()): number {
  return now.getUTCFullYear() + MAX_YEAR_AHEAD;
}

export function isPlausibleDate(date: Date, now: Date = new Date()): boolean {
  if (Number.isNaN(date.getTime())) return false;
  const year = date.getUTCFullYear();
  return year >= MIN_YEAR && year <= maxYear(now);
}

export type YearMonth = { year: number; month: number };

export function isPlausibleMonth(value: YearMonth, now: Date = new Date()): boolean {
  if (!Number.isInteger(value.year) || !Number.isInteger(value.month)) return false;
  if (value.month < 1 || value.month > 12) return false;
  return value.year >= MIN_YEAR && value.year <= maxYear(now);
}

/**
 * Parses `YYYY-MM` from a query string, rejecting anything outside the window.
 *
 * Returns null rather than clamping: silently showing a different month than the URL asked
 * for is more confusing than falling back to the default.
 */
export function parseYearMonth(value: string | undefined, now: Date = new Date()): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;

  const parsed = { year: Number(match[1]), month: Number(match[2]) };
  return isPlausibleMonth(parsed, now) ? parsed : null;
}

const monthIndex = (value: YearMonth) => value.year * 12 + (value.month - 1);

/** True when `value` is at or before `limit`. */
export function isAtOrBefore(value: YearMonth, limit: YearMonth): boolean {
  return monthIndex(value) <= monthIndex(limit);
}

export function stepMonth(value: YearMonth, delta: number): YearMonth {
  const index = monthIndex(value) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
