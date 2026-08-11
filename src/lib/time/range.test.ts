import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE,
  formatRange,
  monthsIn,
  parseRange,
  RANGE_PRESETS,
  resolveRange,
  toTradeFilter,
  type TimeRange,
} from './range';

/** A fixed "now" — mid-August 2026, mid-afternoon in Tel Aviv. */
const NOW = new Date('2026-08-03T12:00:00Z');

describe('the wire form', () => {
  const cases: TimeRange[] = [
    { kind: 'max' },
    { kind: 'thisMonth' },
    { kind: 'lastMonth' },
    { kind: 'months', from: { year: 2026, month: 1 }, to: { year: 2026, month: 3 } },
    { kind: 'dates', from: { year: 2026, month: 1, day: 15 }, to: { year: 2026, month: 2, day: 20 } },
  ];

  it('round-trips every shape the picker can produce', () => {
    for (const range of cases) {
      expect(parseRange(formatRange(range), NOW)).toEqual(range);
    }
  });

  it('writes something a person can read in a shared link', () => {
    expect(formatRange({ kind: 'max' })).toBe('max');
    expect(formatRange({ kind: 'thisMonth' })).toBe('this-month');
    expect(formatRange({ kind: 'lastMonth' })).toBe('last-month');
    expect(
      formatRange({ kind: 'months', from: { year: 2026, month: 1 }, to: { year: 2026, month: 12 } }),
    ).toBe('2026-01..2026-12');
    expect(
      formatRange({
        kind: 'dates',
        from: { year: 2026, month: 3, day: 1 },
        to: { year: 2026, month: 3, day: 9 },
      }),
    ).toBe('2026-03-01..2026-03-09');
  });

  it('covers every preset', () => {
    for (const preset of RANGE_PRESETS) {
      expect(parseRange(formatRange({ kind: preset }), NOW)).toEqual({ kind: preset });
    }
  });
});

describe('reading a stored or hand-edited range', () => {
  it('returns null for anything it does not recognise, so the caller can fall back', () => {
    for (const value of ['', '   ', undefined, null, 'nonsense', 'max..max', '2026-01', '..']) {
      expect(parseRange(value, NOW)).toBeNull();
    }
  });

  it('refuses a pair that mixes a month with a date', () => {
    // Half a window is not a window, and guessing which half to widen would silently show a
    // different span than the URL asked for.
    expect(parseRange('2026-01..2026-03-05', NOW)).toBeNull();
    expect(parseRange('2026-01-05..2026-03', NOW)).toBeNull();
  });

  it('swaps endpoints given the wrong way round', () => {
    expect(parseRange('2026-03..2026-01', NOW)).toEqual({
      kind: 'months',
      from: { year: 2026, month: 1 },
      to: { year: 2026, month: 3 },
    });
    expect(parseRange('2026-03-05..2026-01-05', NOW)).toEqual({
      kind: 'dates',
      from: { year: 2026, month: 1, day: 5 },
      to: { year: 2026, month: 3, day: 5 },
    });
  });

  it('rejects years outside the plausible window', () => {
    // The same bound the finance parser enforces: an entry in the year 1 paired with a request
    // for the year 2999 is a denial of service, not a typo worth honouring.
    expect(parseRange('0001-01..2999-12', NOW)).toBeNull();
    expect(parseRange('1969-01..2026-01', NOW)).toBeNull();
    expect(parseRange('2026-01..2040-01', NOW)).toBeNull();
  });

  it('rejects a day the month does not have', () => {
    expect(parseRange('2026-02-30..2026-03-01', NOW)).toBeNull();
  });

  it('ignores case and surrounding space', () => {
    expect(parseRange('  This-Month ', NOW)).toEqual({ kind: 'thisMonth' });
  });
});

describe('resolving against a moment', () => {
  it('leaves `max` unbounded — the one range that filters nothing', () => {
    const resolved = resolveRange({ kind: 'max' }, NOW);
    expect(resolved.bounded).toBe(false);
    expect(resolved.from).toBeNull();
    expect(resolved.to).toBeNull();
    expect(resolved.months).toBeNull();
    expect(resolved.days).toBeNull();
    expect(toTradeFilter(resolved)).toEqual({});
  });

  /*
   * The default is the current month, not everything.
   *
   * A journal opened on "everything" answers "how am I doing?" with a lifetime average — the
   * one figure that barely moves, and so the one that says least. Pinned as a fact rather
   * than left to whatever `DEFAULT_RANGE` happens to hold, because every screen reads its
   * window from that constant and a change to it moves all of them at once.
   */
  it('defaults to the month in progress, bounded to it', () => {
    expect(DEFAULT_RANGE).toEqual({ kind: 'thisMonth' });
    const resolved = resolveRange(DEFAULT_RANGE, NOW);
    expect(resolved.bounded).toBe(true);
    expect(resolved.from).not.toBeNull();
    expect(resolved.to).not.toBeNull();
  });

  it('reads `thisMonth` off the analytics clock, not the host clock', () => {
    const resolved = resolveRange({ kind: 'thisMonth' }, NOW);
    expect(resolved.fromDate).toEqual({ year: 2026, month: 8, day: 1 });
    expect(resolved.toDate).toEqual({ year: 2026, month: 8, day: 31 });
    expect(resolved.days).toBe(31);
    expect(resolved.months).toEqual({ from: { year: 2026, month: 8 }, to: { year: 2026, month: 8 } });
  });

  it('rolls `thisMonth` over at local midnight, not UTC midnight', () => {
    // 22:30 UTC on the 31st of July is 01:30 on the 1st of August in Tel Aviv. A trader
    // looking at "this month" in those three hours means August.
    const resolved = resolveRange({ kind: 'thisMonth' }, new Date('2026-07-31T22:30:00Z'));
    expect(resolved.fromDate).toEqual({ year: 2026, month: 8, day: 1 });
  });

  it('steps `lastMonth` across a year boundary', () => {
    const resolved = resolveRange({ kind: 'lastMonth' }, new Date('2026-01-10T12:00:00Z'));
    expect(resolved.fromDate).toEqual({ year: 2025, month: 12, day: 1 });
    expect(resolved.toDate).toEqual({ year: 2025, month: 12, day: 31 });
  });

  it('expands a month range to whole months, February included', () => {
    const resolved = resolveRange(
      { kind: 'months', from: { year: 2024, month: 2 }, to: { year: 2024, month: 3 } },
      NOW,
    );
    expect(resolved.fromDate).toEqual({ year: 2024, month: 2, day: 1 });
    // 2024 was a leap year: the 29th, not the 28th, and not the 1st of March.
    expect(resolved.toDate).toEqual({ year: 2024, month: 3, day: 31 });
    expect(resolved.days).toBe(29 + 31);
  });

  it('keeps a date range exactly as given', () => {
    const resolved = resolveRange(
      {
        kind: 'dates',
        from: { year: 2026, month: 1, day: 15 },
        to: { year: 2026, month: 2, day: 20 },
      },
      NOW,
    );
    expect(resolved.days).toBe(37);
    expect(resolved.months).toEqual({
      from: { year: 2026, month: 1 },
      to: { year: 2026, month: 2 },
    });
  });

  it('ends the range on the last millisecond of the final day', () => {
    const resolved = resolveRange(
      {
        kind: 'dates',
        from: { year: 2026, month: 6, day: 1 },
        to: { year: 2026, month: 6, day: 1 },
      },
      NOW,
    );
    // June is summer time in Israel, so the day runs 21:00Z to 20:59:59.999Z.
    expect(resolved.from?.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    expect(resolved.to?.toISOString()).toBe('2026-06-01T20:59:59.999Z');
    expect(resolved.days).toBe(1);
  });

  it('gets the 23-hour day right', () => {
    // Israel springs forward at 02:00 on 2026-03-27, so that day is an hour short. An
    // end-of-day written as 23:59:59 in local time would land an hour into the 28th.
    const resolved = resolveRange(
      {
        kind: 'dates',
        from: { year: 2026, month: 3, day: 27 },
        to: { year: 2026, month: 3, day: 27 },
      },
      NOW,
    );
    expect(resolved.from?.toISOString()).toBe('2026-03-26T22:00:00.000Z');
    expect(resolved.to?.toISOString()).toBe('2026-03-27T20:59:59.999Z');
    expect(resolved.days).toBe(1);
  });

  it('counts calendar days across a clock change rather than 24-hour blocks', () => {
    const resolved = resolveRange(
      {
        kind: 'dates',
        from: { year: 2026, month: 3, day: 26 },
        to: { year: 2026, month: 3, day: 28 },
      },
      NOW,
    );
    expect(resolved.days).toBe(3);
  });

  it('hands the trade query inclusive bounds', () => {
    const resolved = resolveRange({ kind: 'thisMonth' }, NOW);
    const filter = toTradeFilter(resolved);
    expect(filter.from).toEqual(resolved.from);
    expect(filter.to).toEqual(resolved.to);
    // A trade closed during the final afternoon is inside the month.
    expect(new Date('2026-08-31T15:00:00Z').getTime()).toBeLessThan(filter.to!.getTime());
    expect(new Date('2026-09-01T00:00:00Z').getTime()).toBeGreaterThan(filter.to!.getTime());
  });
});

describe('the months a span covers', () => {
  it('lists them oldest first, inclusive of both ends', () => {
    expect(monthsIn({ from: { year: 2025, month: 11 }, to: { year: 2026, month: 2 } })).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });

  it('returns the single month when both ends are the same', () => {
    expect(monthsIn({ from: { year: 2026, month: 6 }, to: { year: 2026, month: 6 } })).toEqual([
      { year: 2026, month: 6 },
    ]);
  });
});
