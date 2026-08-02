import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  displayToIso,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatMonthName,
  formatTime,
  isoToDisplay,
  parseDisplayDate,
  parseIsoDate,
  toIsoDate,
} from './format';

const AUG_2 = { year: 2026, month: 8, day: 2 };

describe('the product writes dates one way', () => {
  it('is day first, month second, four-digit year', () => {
    // The whole point: 2 August, not 8 February. The two are indistinguishable in `08/02`
    // unless the order is fixed, and it is the ambiguity — not the separator — that matters.
    expect(formatDate(AUG_2)).toBe('02/08/2026');
    expect(formatDayMonth(AUG_2)).toBe('02/08');
    expect(formatDateTime({ ...AUG_2, hour: 9, minute: 5 })).toBe('02/08/2026 09:05');
    expect(formatTime(0, 0)).toBe('00:00');
  });

  it('pads every field, so figures line up down a column', () => {
    expect(formatDate({ year: 2026, month: 1, day: 1 })).toBe('01/01/2026');
    expect(formatDateTime({ year: 2026, month: 12, day: 31, hour: 23, minute: 59 })).toBe(
      '31/12/2026 23:59',
    );
  });

  it('does not abbreviate the year', () => {
    // `31/07/26` reads as a day/month/day for anyone scanning quickly, and the operator panel
    // spans years.
    expect(formatDate({ year: 2026, month: 7, day: 31 })).toMatch(/\/2026$/);
  });
});

describe('reading a date back', () => {
  it('round-trips through both representations', () => {
    expect(toIsoDate(AUG_2)).toBe('2026-08-02');
    expect(parseIsoDate('2026-08-02')).toEqual(AUG_2);
    expect(isoToDisplay('2026-08-02')).toBe('02/08/2026');
    expect(displayToIso('02/08/2026')).toBe('2026-08-02');

    for (const iso of ['2026-01-01', '2024-02-29', '1999-12-31', '2026-08-02']) {
      expect(displayToIso(isoToDisplay(iso))).toBe(iso);
    }
  });

  it('accepts what people actually type', () => {
    // Single digits, a dot or a dash, a stray space. All unambiguous, all day-first.
    expect(parseDisplayDate('2/8/2026')).toEqual(AUG_2);
    expect(parseDisplayDate('02.08.2026')).toEqual(AUG_2);
    expect(parseDisplayDate('02-08-2026')).toEqual(AUG_2);
    expect(parseDisplayDate('  02 / 08 / 2026 ')).toEqual(AUG_2);
  });

  it('refuses a two-digit year rather than guessing the century', () => {
    expect(parseDisplayDate('02/08/26')).toBeNull();
  });

  it('refuses a day the month does not have, instead of rolling into the next one', () => {
    // `new Date(2026, 1, 30)` is the 2nd of March, so a typo silently files an entry under
    // the wrong month. Every one of these must be rejected, not corrected.
    expect(parseDisplayDate('30/02/2026')).toBeNull();
    expect(parseDisplayDate('31/04/2026')).toBeNull();
    expect(parseDisplayDate('29/02/2026')).toBeNull(); // 2026 is not a leap year
    expect(parseDisplayDate('29/02/2024')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseIsoDate('2026-02-30')).toBeNull();
  });

  it('refuses nonsense without throwing', () => {
    for (const raw of ['', '  ', 'today', '2026-08-02', '02/08', '1/2/3/4', '00/08/2026', '02/13/2026', '02/00/2026']) {
      expect(parseDisplayDate(raw), raw).toBeNull();
      expect(displayToIso(raw)).toBe('');
    }
    for (const raw of ['', '02/08/2026', '2026-8-2', 'x']) {
      expect(parseIsoDate(raw)).toBeNull();
      expect(isoToDisplay(raw)).toBe('');
    }
  });

  it('reads an American-order date as day-first, because that is the stated rule', () => {
    // `03/04/2026` is the 3rd of April here and nothing else. Worth pinning: the failure this
    // guards against is a future "be helpful and detect the order", which would make the same
    // string mean different things on different rows.
    expect(parseDisplayDate('03/04/2026')).toEqual({ year: 2026, month: 4, day: 3 });
  });
});

describe('month names stay in the reader’s language', () => {
  it('translates the word and leaves the number alone', () => {
    // The order is the product's decision; a month *name* is not a format, it is language.
    expect(formatMonthName({ year: 2026, month: 8 }, 'en')).toBe('August 2026');
    expect(formatMonthName({ year: 2026, month: 8 }, 'he')).toContain('אוגוסט');
    expect(formatMonthName({ year: 2026, month: 8 }, 'he')).toContain('2026');
  });
});

describe('nothing formats a date on its own', () => {
  const SOURCES = globSync('src/**/*.{ts,tsx}').filter(
    (file) => !file.includes('.test.') && !file.endsWith('src/lib/time/format.ts') && !file.endsWith('src/lib/time/zone.ts'),
  );

  it('routes every date through this module', () => {
    // The bug this prevents: one screen showing `2.8.2026`, another `8/2/26`, the operator
    // panel `2026-08-02`. Three orders for one instant, and two of them are unreadable
    // without knowing which locale produced them. `Intl.DateTimeFormat` is still correct for
    // *words* — month and weekday names — so those are allowed and everything else is not.
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const source = readFileSync(file, 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        const formatsDate =
          /toLocaleDateString|toLocaleString\(/.test(line) ||
          /toISOString\(\)\.slice/.test(line) ||
          (/DateTimeFormat/.test(line) &&
            !/month: 'long'|weekday:|formatToParts|Intl\.DateTimeFormatPartTypes|Map<string/.test(
              source.slice(source.indexOf(line), source.indexOf(line) + 260),
            ));
        if (formatsDate) offenders.push(`${file}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
