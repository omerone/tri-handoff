import { describe, expect, it } from 'vitest';
import {
  isAtOrBefore,
  isPlausibleDate,
  isPlausibleMonth,
  MIN_YEAR,
  parseYearMonth,
  stepMonth,
} from './bounds';
import { cumulativeCash, type FinanceEntry } from './balance';
import { monthsWithActivity, MAX_NAVIGABLE_MONTHS } from './recurring';

/**
 * These bounds exist because of a specific, measured attack, not out of tidiness.
 *
 * `cumulativeCash` used to walk the calendar month by month from the oldest entry, rescanning
 * every entry each step. One entry dated in the year 1 plus `?m=2999-12` produced ~36,000
 * iterations — ten seconds of blocking CPU on the event loop shared by every tenant. The
 * accumulation is now arithmetic rather than iteration, and the inputs are bounded as well:
 * either fix alone would do, and both together mean the next person to reintroduce a loop
 * cannot reintroduce the vulnerability with it.
 */

const NOW = new Date('2026-08-02T00:00:00Z');
const day = (year: number, month: number, d: number) => new Date(Date.UTC(year, month - 1, d));

describe('isPlausibleDate', () => {
  it('accepts ordinary dates and a few years ahead', () => {
    expect(isPlausibleDate(day(2026, 8, 2), NOW)).toBe(true);
    expect(isPlausibleDate(day(1999, 1, 1), NOW)).toBe(true);
    expect(isPlausibleDate(day(2030, 12, 31), NOW)).toBe(true);
  });

  it('rejects the year-1 date that made the month loop a weapon', () => {
    expect(isPlausibleDate(day(1, 1, 1), NOW)).toBe(false);
    expect(isPlausibleDate(day(MIN_YEAR - 1, 6, 1), NOW)).toBe(false);
  });

  it('rejects a fat-fingered far-future year', () => {
    expect(isPlausibleDate(day(9999, 1, 1), NOW)).toBe(false);
  });

  it('rejects an invalid date rather than passing NaN downstream', () => {
    expect(isPlausibleDate(new Date('nonsense'), NOW)).toBe(false);
  });
});

describe('parseYearMonth', () => {
  it('parses a well-formed month', () => {
    expect(parseYearMonth('2026-07', NOW)).toEqual({ year: 2026, month: 7 });
  });

  it('rejects the far-future month rather than clamping it', () => {
    // Clamping would silently show a different month than the URL asked for, which is more
    // confusing than falling back to the default.
    expect(parseYearMonth('2999-12', NOW)).toBeNull();
    expect(parseYearMonth('0001-01', NOW)).toBeNull();
  });

  it('rejects a month outside 1–12 and anything malformed', () => {
    expect(parseYearMonth('2026-00', NOW)).toBeNull();
    expect(parseYearMonth('2026-13', NOW)).toBeNull();
    expect(parseYearMonth('2026-7', NOW)).toBeNull();
    expect(parseYearMonth('', NOW)).toBeNull();
    expect(parseYearMonth(undefined, NOW)).toBeNull();
  });
});

describe('isPlausibleMonth', () => {
  it('rejects the values that reached Date.UTC as an Invalid Date', () => {
    // `endRecurringSeriesAction` only checked Number.isInteger, so 1e15 produced an Invalid
    // Date and a 500, and month 0 or 13 silently rolled into the adjacent year.
    expect(isPlausibleMonth({ year: 1e15, month: 6 }, NOW)).toBe(false);
    expect(isPlausibleMonth({ year: 2026, month: 1e9 }, NOW)).toBe(false);
    expect(isPlausibleMonth({ year: 2026, month: 0 }, NOW)).toBe(false);
    expect(isPlausibleMonth({ year: 2026, month: 13 }, NOW)).toBe(false);
    expect(isPlausibleMonth({ year: 2026.5, month: 6 }, NOW)).toBe(false);
  });

  it('accepts a real month', () => {
    expect(isPlausibleMonth({ year: 2026, month: 8 }, NOW)).toBe(true);
  });
});

describe('stepMonth and isAtOrBefore', () => {
  /*
   * These order months so the finance page can ask "is the month being viewed ahead of
   * today?". Browsing forward is allowed — seeing next month's recurring entries is the
   * point of recurring entries — but the running totals are computed as of today, so a
   * projection never gets presented as a fact.
   */
  it('crosses year boundaries in both directions', () => {
    expect(stepMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(stepMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('orders months across years', () => {
    expect(isAtOrBefore({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBe(true);
    expect(isAtOrBefore({ year: 2026, month: 8 }, { year: 2026, month: 8 })).toBe(true);
    expect(isAtOrBefore({ year: 2026, month: 9 }, { year: 2026, month: 8 })).toBe(false);
  });
});

describe('cumulativeCash is no longer a loop', () => {
  const entry = (over: Partial<FinanceEntry>): FinanceEntry => ({
    id: 'e',
    type: 'income',
    category: 'salary',
    label: 'Salary',
  owner: null,
    amountIls: 1_000,
    entryDate: day(2026, 1, 1),
    isRecurring: false,
    recurringUntil: null,
    ...over,
  });

  it('returns instantly for a span that used to take tens of thousands of iterations', () => {
    // The old implementation walked ~36,000 months here, rescanning every entry each time.
    const entries = Array.from({ length: 500 }, (_, index) =>
      entry({ id: `e${index}`, entryDate: day(1, 1, 1), isRecurring: true, amountIls: 1 }),
    );

    const started = performance.now();
    const total = cumulativeCash(entries, { year: 2999, month: 12 });
    const elapsed = performance.now() - started;

    expect(Number.isFinite(total)).toBe(true);
    // Generous by three orders of magnitude against the 10.5 seconds measured before.
    expect(elapsed).toBeLessThan(50);
  });

  it('still counts a recurring series exactly, month for month', () => {
    const entries = [entry({ entryDate: day(2026, 1, 1), isRecurring: true, amountIls: 1_000 })];
    expect(cumulativeCash(entries, { year: 2026, month: 1 })).toBe(1_000);
    expect(cumulativeCash(entries, { year: 2026, month: 12 })).toBe(12_000);
    expect(cumulativeCash(entries, { year: 2027, month: 6 })).toBe(18_000);
  });

  it('honours the end of a series', () => {
    const entries = [
      entry({
        entryDate: day(2026, 1, 1),
        isRecurring: true,
        amountIls: 1_000,
        recurringUntil: day(2026, 3, 31),
      }),
    ];
    // Three payments, and nothing after March however far forward you look.
    expect(cumulativeCash(entries, { year: 2026, month: 3 })).toBe(3_000);
    expect(cumulativeCash(entries, { year: 2030, month: 12 })).toBe(3_000);
  });

  it('nets income against expenses', () => {
    const entries = [
      entry({ entryDate: day(2026, 1, 1), isRecurring: true, amountIls: 10_000 }),
      entry({ id: 'x', type: 'expense', entryDate: day(2026, 1, 5), isRecurring: true, amountIls: 4_000 }),
    ];
    expect(cumulativeCash(entries, { year: 2026, month: 3 })).toBe(18_000);
  });

  it('ignores an entry dated after the month asked for', () => {
    const entries = [entry({ entryDate: day(2027, 5, 1) })];
    expect(cumulativeCash(entries, { year: 2026, month: 12 })).toBe(0);
  });
});

describe('monthsWithActivity is bounded', () => {
  it('does not build a list thousands of entries long for one ancient date', () => {
    const entries = [
      { id: 'e', entryDate: day(1, 1, 1), isRecurring: false, recurringUntil: null },
    ];
    const months = monthsWithActivity(entries, { year: 2026, month: 8 });
    expect(months.length).toBeLessThanOrEqual(MAX_NAVIGABLE_MONTHS + 1);
  });

  it('still lists every month for a normal span', () => {
    const entries = [
      { id: 'e', entryDate: day(2026, 5, 10), isRecurring: false, recurringUntil: null },
    ];
    expect(monthsWithActivity(entries, { year: 2026, month: 8 })).toHaveLength(4);
  });
});
