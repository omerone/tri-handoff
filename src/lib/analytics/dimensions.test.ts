import { describe, expect, it } from 'vitest';
import { recentDailyR } from './dimensions';
import type { AnalyticsTrade } from './types';

/**
 * The daily window behind the R-strip.
 *
 * The strip used to show one bar per trade, which made "the last sixty" a different span
 * every time the trader looked at it. These pin the calendar behaviour instead.
 */

let counter = 0;
function seedTrade(): AnalyticsTrade {
  counter += 1;
  const openAt = new Date('2026-07-01T09:00:00Z');
  return {
    id: `d${counter}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt,
    closeAt: new Date(openAt.getTime() + 3_600_000),
    profit: 100,
    risk: 100,
    rr: 1,
    strategy: null,
    tpTiming: null,
    tookOriginalTp: null,
  };
}

describe('recentDailyR', () => {
  const at = (iso: string, rr: number | null, profit = rr === null ? 10 : rr * 100) =>
    ({ ...seedTrade(), closeAt: new Date(iso), rr, profit }) as AnalyticsTrade;

  it('returns one entry per calendar day, oldest first', () => {
    const window = recentDailyR([at('2026-07-31T09:00:00Z', 1)], 30);
    expect(window).toHaveLength(30);
    expect(window.at(-1)?.date).toBe('2026-07-31');
    expect(window[0]?.date).toBe('2026-07-02');
    for (let i = 1; i < window.length; i += 1) {
      expect(window[i]!.date > window[i - 1]!.date).toBe(true);
    }
  });

  it('keeps quiet days in the window, because the gaps are the point', () => {
    // A strip that dropped empty days would compress a week off into nothing and make six
    // bars look like six consecutive sessions.
    const window = recentDailyR([at('2026-07-31T09:00:00Z', 1), at('2026-07-25T09:00:00Z', 2)], 10);
    expect(window).toHaveLength(10);
    expect(window.filter((day) => day.count === 0)).toHaveLength(8);
    expect(window.filter((day) => day.count > 0).map((day) => day.date)).toEqual([
      '2026-07-25',
      '2026-07-31',
    ]);
  });

  it('sums a day’s trades', () => {
    const window = recentDailyR([
      at('2026-07-31T08:00:00Z', 1.5, 300),
      at('2026-07-31T14:00:00Z', -0.5, -100),
      at('2026-07-31T18:00:00Z', 2, 400),
    ], 3);
    const day = window.at(-1)!;
    expect(day.count).toBe(3);
    expect(day.wins).toBe(2);
    expect(day.netR).toBeCloseTo(3, 10);
    expect(day.net).toBeCloseTo(600, 10);
  });

  it('excludes a trade with no stop loss from R, and says how many counted', () => {
    // Same rule as every other R aggregate: no stop loss, no R. Reporting `rrTrades` lets a
    // day computed from half its trades admit it rather than looking complete.
    const window = recentDailyR([
      at('2026-07-31T08:00:00Z', 2, 400),
      at('2026-07-31T12:00:00Z', null, 50),
    ], 1);
    const day = window[0]!;
    expect(day.count).toBe(2);
    expect(day.rrTrades).toBe(1);
    expect(day.netR).toBeCloseTo(2, 10);
  });

  it('ends on the last day traded rather than today', () => {
    // A demo account, or a trader back from a break, would otherwise open on thirty empty
    // columns and conclude the strip was broken.
    const window = recentDailyR([at('2024-01-15T09:00:00Z', 1)], 5);
    expect(window.at(-1)?.date).toBe('2024-01-15');
    expect(window[0]?.date).toBe('2024-01-11');
  });

  it('crosses a month and a year boundary correctly', () => {
    const window = recentDailyR([at('2026-01-02T09:00:00Z', 1)], 4);
    expect(window.map((day) => day.date)).toEqual([
      '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02',
    ]);
  });

  it('returns nothing for an empty book', () => {
    expect(recentDailyR([], 30)).toEqual([]);
  });
});
