/**
 * The time range every screen is read through.
 *
 * One model, one query parameter, one cookie. Before this each screen answered "when" its own
 * way — the dashboard was always all-time, the calendar and finance had month arrows, the
 * trades table had no date filter at all — so "how did I do last month" was a different
 * gesture on every page and impossible on three of them.
 *
 * Two things are deliberately separated here:
 *
 * **The range** is what the user picked, and it is what gets stored. `thisMonth` stays
 * `thisMonth`; it is not frozen into the month it happened to mean when it was picked. A
 * bookmark, a shared link and a cookie from three weeks ago all keep meaning the current
 * month, which is what the words say.
 *
 * **The resolution** is what that means as instants, and it is computed per request against
 * `now` and the analytics timezone. Every boundary in this file is a wall-clock boundary in
 * `ANALYTICS_TIME_ZONE` — the same zone that decides which square a trade lands on in the
 * calendar. Using UTC midnight instead would put a trade closed at 00:30 in Tel Aviv in the
 * previous month for anyone browsing "this month" during the first hours of the 1st.
 */

import type { Locale } from '@/i18n/config';
import { isPlausibleMonth, stepMonth, type YearMonth } from '@/lib/finance/bounds';
import { formatDate, formatMonthName, parseIsoDate, toIsoDate, type DateParts } from './format';
import { fromWallClock, wallClock } from './zone';

/** The three answers that need no further input. */
export const RANGE_PRESETS = ['max', 'thisMonth', 'lastMonth'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** Every shape the picker can produce, including the two that carry their own bounds. */
export type RangeKind = RangePreset | 'months' | 'dates';

export type TimeRange =
  | { kind: RangePreset }
  | { kind: 'months'; from: YearMonth; to: YearMonth }
  | { kind: 'dates'; from: DateParts; to: DateParts };

/**
 * The current month, and the default.
 *
 * It was `max` — everything — on the reasoning that a new user has no reason to be looking at
 * a window and that this was where the product already sat before the picker existed. That is
 * an argument about an empty account, and it stops holding the moment the account fills up:
 * a trading journal opened on "everything" answers "how am I doing?" with a lifetime average,
 * which is the one figure that barely moves and so the one that says least. The month is the
 * unit the trader actually works in — a P&L, a set of costs, a study ledger, all bounded by
 * the period they are being judged over.
 *
 * Every screen still reads it from one place, so `max` remains one press away and a link
 * carrying `?range=max` still overrides this exactly as it always did.
 */
export const DEFAULT_RANGE: TimeRange = { kind: 'thisMonth' };

/** The query-string parameter and the cookie both use this spelling. */
export const RANGE_PARAM = 'range';

const PRESET_TOKEN: Record<RangePreset, string> = {
  max: 'max',
  thisMonth: 'this-month',
  lastMonth: 'last-month',
};

const TOKEN_PRESET = new Map<string, RangePreset>(
  RANGE_PRESETS.map((preset) => [PRESET_TOKEN[preset], preset]),
);

/** The token a preset button submits. Exported so the UI cannot spell one differently. */
export const presetToken = (preset: RangePreset): string => PRESET_TOKEN[preset];

const pad = (value: number) => String(value).padStart(2, '0');
const monthToken = (value: YearMonth) => `${value.year}-${pad(value.month)}`;

/**
 * The wire form: `max`, `this-month`, `last-month`, `2026-01..2026-03`, `2026-01-15..2026-02-20`.
 *
 * Readable in a URL on purpose — a range in a shared link should be legible to the person
 * receiving it — and self-describing, so the two custom shapes need no prefix to tell apart:
 * a `YYYY-MM` pair is months, a `YYYY-MM-DD` pair is dates.
 */
export function formatRange(range: TimeRange): string {
  if (range.kind === 'months') return `${monthToken(range.from)}..${monthToken(range.to)}`;
  if (range.kind === 'dates') return `${toIsoDate(range.from)}..${toIsoDate(range.to)}`;
  return PRESET_TOKEN[range.kind];
}

const monthIndex = (value: YearMonth) => value.year * 12 + (value.month - 1);

function parseMonthToken(value: string, now: Date): YearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = { year: Number(match[1]), month: Number(match[2]) };
  return isPlausibleMonth(parsed, now) ? parsed : null;
}

function parseDateToken(value: string, now: Date): DateParts | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  // The same window the finance bounds enforce, and for the same reason: a year outside it is
  // a typo in every real case, and accepting it hands a stranger the arithmetic in this file.
  return isPlausibleMonth({ year: parsed.year, month: parsed.month }, now) ? parsed : null;
}

/**
 * Reads a stored or shared range. Returns null for anything it does not recognise, so the
 * caller falls back to a default rather than showing a window nobody asked for.
 *
 * Endpoints given the wrong way round are swapped rather than rejected. In a hand-edited URL
 * "March back to January" is unambiguous, and the picker cannot produce it at all — refusing
 * would trade a clear intent for an error message that explains nothing.
 */
export function parseRange(value: string | undefined | null, now: Date = new Date()): TimeRange | null {
  const token = (value ?? '').trim().toLowerCase();
  if (!token) return null;

  const preset = TOKEN_PRESET.get(token);
  if (preset) return { kind: preset };

  const [left, right, ...rest] = token.split('..');
  if (rest.length > 0 || left === undefined || right === undefined) return null;

  const months = [parseMonthToken(left, now), parseMonthToken(right, now)] as const;
  if (months[0] && months[1]) {
    const [from, to] =
      monthIndex(months[0]) <= monthIndex(months[1])
        ? [months[0], months[1]]
        : [months[1], months[0]];
    return { kind: 'months', from, to };
  }

  const dates = [parseDateToken(left, now), parseDateToken(right, now)] as const;
  if (dates[0] && dates[1]) {
    const [from, to] =
      toIsoDate(dates[0]) <= toIsoDate(dates[1]) ? [dates[0], dates[1]] : [dates[1], dates[0]];
    return { kind: 'dates', from, to };
  }

  return null;
}

export type MonthSpan = { from: YearMonth; to: YearMonth };

/**
 * A range as the rest of the app needs it.
 *
 * `from`/`to` are inclusive instants — `to` is the last millisecond of its day, which is what
 * makes a `closeAt <= to` query include trades closed during the final afternoon. `null` on
 * either side means unbounded.
 */
export type ResolvedRange = {
  range: TimeRange;
  from: Date | null;
  to: Date | null;
  /** The endpoints as calendar dates, for labelling. Null exactly when the side is unbounded. */
  fromDate: DateParts | null;
  toDate: DateParts | null;
  /** Whole months covered — a date range reports the months containing its endpoints. */
  months: MonthSpan | null;
  /** Calendar days covered, inclusive of both ends. Null when unbounded. */
  days: number | null;
  /** False only for `max`: the one range that filters nothing. */
  bounded: boolean;
};

const DAY_MS = 86_400_000;

const daysInMonth = (value: YearMonth): number =>
  new Date(Date.UTC(value.year, value.month, 0)).getUTCDate();

const firstOfMonth = (value: YearMonth): DateParts => ({ ...value, day: 1 });
const lastOfMonth = (value: YearMonth): DateParts => ({ ...value, day: daysInMonth(value) });

/** Midnight at the start of a calendar day, in the analytics zone. */
const startOfDay = (date: DateParts): Date => fromWallClock(date);

/**
 * The last millisecond of a calendar day.
 *
 * Derived by stepping to the next day and going back one millisecond rather than by writing
 * 23:59:59.999, because on the two days a year the zone shifts, the day is 23 or 25 hours long
 * and a hardcoded end-of-day is either an hour short or an hour into the next day.
 */
function endOfDay(date: DateParts): Date {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day) + DAY_MS);
  const nextDay = {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
  return new Date(startOfDay(nextDay).getTime() - 1);
}

/** Inclusive day count between two calendar dates. */
function daysBetween(from: DateParts, to: DateParts): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / DAY_MS) + 1;
}

const unbounded = (range: TimeRange): ResolvedRange => ({
  range,
  from: null,
  to: null,
  fromDate: null,
  toDate: null,
  months: null,
  days: null,
  bounded: false,
});

function resolveDates(range: TimeRange, from: DateParts, to: DateParts): ResolvedRange {
  return {
    range,
    from: startOfDay(from),
    to: endOfDay(to),
    fromDate: from,
    toDate: to,
    months: {
      from: { year: from.year, month: from.month },
      to: { year: to.year, month: to.month },
    },
    days: daysBetween(from, to),
    bounded: true,
  };
}

/**
 * A range, resolved against a moment. `now` is a parameter rather than a call to `new Date()`
 * so the whole model is testable without freezing the clock.
 */
export function resolveRange(range: TimeRange, now: Date = new Date()): ResolvedRange {
  switch (range.kind) {
    case 'max':
      return unbounded(range);

    case 'thisMonth':
    case 'lastMonth': {
      const today = wallClock(now);
      const thisMonth = { year: today.year, month: today.month };
      const month = range.kind === 'thisMonth' ? thisMonth : stepMonth(thisMonth, -1);
      return resolveDates(range, firstOfMonth(month), lastOfMonth(month));
    }

    case 'months':
      return resolveDates(range, firstOfMonth(range.from), lastOfMonth(range.to));

    case 'dates':
      return resolveDates(range, range.from, range.to);
  }
}

/** The months a span covers, oldest first. */
export function monthsIn(span: MonthSpan): YearMonth[] {
  const count = monthIndex(span.to) - monthIndex(span.from) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, offset) => stepMonth(span.from, offset));
}

/**
 * What the range says, in words the reader can check against what they picked.
 *
 * Null for an unbounded range: "everything" is a translated word rather than a date, and the
 * caller already has the catalogue open.
 *
 * A whole-month span is named by its months — "אוגוסט 2026" reads better than "01/08/2026 –
 * 31/08/2026" and is what the user chose — while a date range is shown to the day, in the
 * product's `dd/mm/yyyy` order. The distinction is `months`, not the endpoints: a date range
 * that happens to land on the 1st and the 31st was still typed as dates and is echoed back
 * that way.
 */
export function describeRange(resolved: ResolvedRange, locale: Locale): string | null {
  const { range, fromDate, toDate } = resolved;
  if (!fromDate || !toDate) return null;

  if (range.kind === 'dates') {
    const from = formatDate(fromDate);
    const to = formatDate(toDate);
    return from === to ? from : `${from} – ${to}`;
  }

  const from = formatMonthName(fromDate, locale);
  const to = formatMonthName(toDate, locale);
  return from === to ? from : `${from} – ${to}`;
}

/**
 * The range as a trade filter.
 *
 * Trades are placed by `closeAt`: a position is performance on the day it was realised, which
 * is the same rule the calendar squares and the daily totals already use. A swing trade opened
 * in January and closed in March belongs to March in every view, rather than to whichever view
 * happens to be asking.
 */
export function toTradeFilter(resolved: ResolvedRange): { from?: Date; to?: Date } {
  return {
    ...(resolved.from ? { from: resolved.from } : {}),
    ...(resolved.to ? { to: resolved.to } : {}),
  };
}
