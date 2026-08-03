import { LOCALE_TAG, type Locale } from '@/i18n/config';
import { maxYear, MIN_YEAR } from '@/lib/finance/bounds';
import { wallClock } from './zone';

/**
 * What the month pickers offer. Pure, so the shell can compute it once and hand it down.
 */

/** How far back the year list goes. A decade covers any book a retail trader brings. */
const YEARS_BACK = 10;
/** And one forward, which is as far as a range can usefully point. */
const YEARS_AHEAD = 1;

/**
 * The years selectable in a month range, oldest first.
 *
 * Clamped to the same window `parseRange` accepts, so the picker cannot offer a year that
 * would be rejected on submission — a dropdown whose options do nothing is worse than a
 * shorter dropdown.
 */
export function selectableYears(now: Date = new Date()): number[] {
  const current = wallClock(now).year;
  const first = Math.max(MIN_YEAR, current - YEARS_BACK);
  const last = Math.min(maxYear(now), current + YEARS_AHEAD);
  return Array.from({ length: Math.max(1, last - first + 1) }, (_, index) => first + index);
}

/**
 * Twelve month names in the reader's language, January first.
 *
 * A *name*, not a number: this is the same split `formatMonthName` and `formatWeekdayDate`
 * make. The order of a date is a product decision, but the word for a month is language, and
 * "03" in a dropdown next to "2026" is one more thing to decode.
 */
export function monthNames(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(LOCALE_TAG[locale], { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, index) =>
    format.format(new Date(Date.UTC(2026, index, 15))),
  );
}
