import type { Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { ANALYTICS_TIME_ZONE, wallClock } from './zone';

/**
 * Dates, written the same way everywhere in the product: `dd/mm/yyyy`.
 *
 * Not `Intl.DateTimeFormat(locale)`. Locale-derived dates disagreed screen by screen — the
 * Hebrew short form is `2.8.2026` with dots, the English one is `8/2/26` with the month
 * first, and the operator panel printed ISO `2026-08-02`. Three orders for the same instant,
 * and the two numeric ones are indistinguishable for any day before the 13th: a trader
 * reading `08/02` cannot tell the 8th of February from the 2nd of August.
 *
 * So the order is fixed by the product rather than by the reader's locale, and the year is
 * always four digits. What stays localised is anything with words in it — month names,
 * weekday names — where the locale is the whole point.
 *
 * The separator is `/` rather than `.` because that is what the client asked for and what
 * the date fields accept as input; one separator in, the same separator out.
 */

const pad = (value: number) => String(value).padStart(2, '0');

export type DateParts = { year: number; month: number; day: number };

/** `dd/mm/yyyy`. */
export function formatDate(parts: DateParts): string {
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

/** `dd/mm` — for dense rows where the year is already established by the surrounding view. */
export function formatDayMonth(parts: DateParts): string {
  return `${pad(parts.day)}/${pad(parts.month)}`;
}

/** `HH:mm`, 24-hour. Both supported locales write time this way. */
export function formatTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

/** `dd/mm/yyyy HH:mm`. */
export function formatDateTime(parts: DateParts & { hour: number; minute: number }): string {
  return `${formatDate(parts)} ${formatTime(parts.hour, parts.minute)}`;
}

/**
 * The `yyyy-mm-dd` a date input and the database both use.
 *
 * Kept here beside its inverse so the two cannot drift: this is the only pair of functions
 * in the product that has to round-trip exactly.
 */
export function toIsoDate(parts: DateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Reads `yyyy-mm-dd`. Returns null for anything else, including a real-looking `2026-02-30`. */
export function parseIsoDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return validate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Reads what a person types into a date field: `dd/mm/yyyy`.
 *
 * Deliberately strict about the order and lenient about everything else — a single digit,
 * a dot or a dash instead of a slash, stray spaces. Being lenient about the *order* is what
 * we cannot do: `03/04/2026` has to mean one thing, and guessing would silently file a trade
 * under the wrong month.
 */
export function parseDisplayDate(value: string): DateParts | null {
  const match = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return validate(Number(match[3]), Number(match[2]), Number(match[1]));
}

/** `yyyy-mm-dd` → `dd/mm/yyyy`, or '' when the value is not a date. */
export function isoToDisplay(iso: string): string {
  const parts = parseIsoDate(iso);
  return parts ? formatDate(parts) : '';
}

/** `yyyy-mm-dd` → `dd/mm`, or '' when the value is not a date. */
export function isoToDayMonth(iso: string): string {
  const parts = parseIsoDate(iso);
  return parts ? formatDayMonth(parts) : '';
}

/** `dd/mm/yyyy` → `yyyy-mm-dd`, or '' when the value is not a date. */
export function displayToIso(display: string): string {
  const parts = parseDisplayDate(display);
  return parts ? toIsoDate(parts) : '';
}

/**
 * Rejects a day the month does not have.
 *
 * `new Date(2026, 1, 30)` rolls forward to the 2nd of March rather than failing, which is how
 * a typo becomes a real date in the wrong month. Comparing the parts back is what catches it.
 */
function validate(year: number, month: number, day: number): DateParts | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * A month name, which *is* localised — "אוגוסט 2026" against "August 2026".
 *
 * Here rather than inline so that every call site that shows a month goes through one place,
 * and it is obvious which parts of a date follow the reader and which follow the product.
 */
export function formatMonthName(parts: { year: number; month: number }, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, 15)));
}

/**
 * `יום חמישי, 23/07/2026` — the weekday named in the reader's language, the date in the
 * product's order.
 *
 * The split is deliberate and is the same one `formatMonthName` makes: a weekday *name* is
 * language, so it follows the locale; the order of the numbers is a product decision, so it
 * does not.
 */
export function formatWeekdayDate(parts: DateParts, locale: Locale): string {
  const weekday = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-GB', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
  return `${weekday}, ${formatDate(parts)}`;
}

/** `yyyy-mm-dd` → `יום חמישי, 23/07/2026`, or '' when the value is not a date. */
export function isoToWeekdayDate(iso: string, locale: Locale): string {
  const parts = parseIsoDate(iso);
  return parts ? formatWeekdayDate(parts, locale) : '';
}

/*
 * The same formats, taking an instant.
 *
 * They read the clock through `wallClock`, so a date is the date it was in the analytics
 * timezone — the same zone that decides which square a trade lands on in the calendar. Left
 * to the server's own zone, a trade closed at 00:30 in Tel Aviv would show one date in the
 * table and sit on the previous day in the calendar.
 *
 * `timeZone` is exposed for the date-only columns, which are stored as UTC midnight and mean
 * a calendar date rather than an instant.
 */

export function formatDateAt(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): string {
  return formatDate(wallClock(instant, timeZone));
}

export function formatDayMonthAt(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): string {
  return formatDayMonth(wallClock(instant, timeZone));
}

export function formatTimeAt(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): string {
  const parts = wallClock(instant, timeZone);
  return formatTime(parts.hour, parts.minute);
}

export function formatDateTimeAt(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): string {
  return formatDateTime(wallClock(instant, timeZone));
}

/**
 * A span of minutes, read the way a trader says it: minutes under an hour, hours and minutes
 * under a day, days and hours beyond that.
 *
 * Lived in the single-trade page until the hold-time comparison on the analytics screen
 * needed the same thing. Two copies of a formatter drift, and a hold time that reads "90m"
 * on one screen and "1h 30m" on another is two facts as far as the reader is concerned.
 */
/**
 * Unit suffixes, per locale.
 *
 * In code rather than in the message files, following `CURRENCY_SYMBOL`: this is a formatter,
 * it is synchronous, and it is called from places that cannot await a translator. A bare `m`
 * in a Hebrew sentence reads as an English abbreviation nobody chose — "35 דק'" is what the
 * person actually says.
 */
const DURATION_UNITS: Record<Locale, { d: string; h: string; m: string }> = {
  he: { d: 'י', h: 'ש', m: "דק'" },
  en: { d: 'd', h: 'h', m: 'm' },
};

/**
 * A span of minutes, written the way it is spoken.
 *
 * The minutes are kept beside the hours rather than folded into a decimal. "1.65h" is a number
 * a person has to convert before it means anything; "1h 39דק'" is the answer. It is why the
 * study ledger takes minutes as their own field, and it is the same shape a hold time wants.
 *
 * A whole number of hours drops the minutes — "2ש" rather than "2ש 0דק'".
 */
export function formatDuration(
  minutes: number,
  locale: Locale,
  options: { maxUnit?: 'day' | 'hour' } = {},
): string {
  const unit = DURATION_UNITS[locale] ?? DURATION_UNITS.en;
  const whole = Math.max(0, Math.round(minutes));

  if (whole < 60) return `${formatNumber(whole, locale)}${unit.m}`;

  /*
   * Where the largest unit stops, and it is not the same answer for both callers.
   *
   * A hold time rolls up: a position held for fifty hours is "2d 2h", because days are how a
   * swing trade is described and the minutes stopped mattering a long time before that. A
   * study ledger does not: nobody says they studied for two days, and rolling up drops the
   * minutes — which is the whole thing the ledger was asked to show. Fifty-two hours of study
   * is "52h 20m".
   */
  if (options.maxUnit === 'hour' || whole < 60 * 24) {
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest === 0
      ? `${formatNumber(hours, locale)}${unit.h}`
      : `${formatNumber(hours, locale)}${unit.h} ${formatNumber(rest, locale)}${unit.m}`;
  }

  const days = Math.floor(whole / (60 * 24));
  const hours = Math.floor((whole % (60 * 24)) / 60);
  return hours === 0
    ? `${formatNumber(days, locale)}${unit.d}`
    : `${formatNumber(days, locale)}${unit.d} ${formatNumber(hours, locale)}${unit.h}`;
}

/** Hours as stored → the same span in whole minutes, which is what the ledger is entered in. */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}
