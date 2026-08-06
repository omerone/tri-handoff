import { describe, expect, it } from 'vitest';
import { monthGrid, monthlyReturns, yearlyReturns } from './periods';
import type { AnalyticsTrade } from './types';

let seq = 0;

/**
 * A trade closed at 09:00 UTC, which is midday in the analytics zone whatever the DST
 * offset — so no fixture here sits near a boundary where the month could go either way.
 */
function closed(day: string, profit: number): AnalyticsTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt: new Date(`${day}T08:00:00Z`),
    closeAt: new Date(`${day}T09:00:00Z`),
    profit,
    commission: 0,
    swap: 0,
    volume: 1,
    mae: null,
    mfe: null,
    risk: null,
    rr: null,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
  };
}

describe('monthlyReturns', () => {
  it('is empty for an empty book', () => {
    expect(monthlyReturns([], 10_000)).toEqual([]);
  });

  it('buckets by close date and orders oldest first', () => {
    const months = monthlyReturns(
      [closed('2026-03-15', 100), closed('2026-01-10', 50), closed('2026-02-20', 75)],
      10_000,
    );
    expect(months.map((m) => m.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('sums a month and counts its wins', () => {
    const months = monthlyReturns(
      [closed('2026-01-05', 100), closed('2026-01-20', -40), closed('2026-01-25', 60)],
      10_000,
    );
    expect(months).toHaveLength(1);
    expect(months[0]!.net).toBe(120);
    expect(months[0]!.trades).toBe(3);
    expect(months[0]!.wins).toBe(2);
    expect(months[0]!.winRate).toBeCloseTo(66.667, 2);
  });

  it('compounds: each month is measured against the balance it opened with', () => {
    // 10,000 → +1,000 (10%) → 11,000 → +1,100 (10%) → 12,100.
    const months = monthlyReturns([closed('2026-01-15', 1000), closed('2026-02-15', 1100)], 10_000);

    expect(months[0]!.openingBalance).toBe(10_000);
    expect(months[0]!.percent).toBeCloseTo(10, 10);
    expect(months[1]!.openingBalance).toBe(11_000);
    expect(months[1]!.percent).toBeCloseTo(10, 10);
  });

  it('makes the same money look smaller on a bigger account, which is the point', () => {
    const months = monthlyReturns([closed('2026-01-15', 2000), closed('2026-06-15', 2000)], 20_000);
    expect(months[0]!.percent).toBeCloseTo(10, 10);
    expect(months[1]!.percent).toBeCloseTo(2000 / 22_000 * 100, 10);
    expect(months[1]!.net).toBe(months[0]!.net);
  });

  it('has no percentage against a balance that is not a base', () => {
    // A blown account is not a denominator. The money figure still reads.
    const months = monthlyReturns([closed('2026-01-15', 500)], 0);
    expect(months[0]!.percent).toBeNull();
    expect(months[0]!.net).toBe(500);
  });

  it('gives no month a percentage when the account never recorded a deposit', () => {
    /*
     * Seen on production: an account with no `balance` deal has an opening balance of zero,
     * so the first month correctly had no percentage — and the second was then measured
     * against the first month's *profit*, reporting +1,014% beside a year total of "—".
     * Every base after the first is derived from a number that was never real.
     */
    const months = monthlyReturns(
      [closed('2026-07-15', 2119), closed('2026-08-15', 21_488)],
      0,
    );

    expect(months.map((m) => m.percent)).toEqual([null, null]);
    // The money is untouched: what each month made is still a fact.
    expect(months.map((m) => m.net)).toEqual([2119, 21_488]);
    expect(yearlyReturns(months)[0]!.percent).toBeNull();
  });

  it('still measures normally once there is a real deposit to measure against', () => {
    const months = monthlyReturns([closed('2026-07-15', 1000)], 10_000);
    expect(months[0]!.percent).toBeCloseTo(10, 10);
  });

  it('skips months with no trades without disturbing the running balance', () => {
    const months = monthlyReturns([closed('2026-01-15', 1000), closed('2026-05-15', 500)], 10_000);
    expect(months.map((m) => m.key)).toEqual(['2026-01', '2026-05']);
    // May opens on January's closing balance, not on the original deposit.
    expect(months[1]!.openingBalance).toBe(11_000);
  });

  it('splits the same month across two years', () => {
    const months = monthlyReturns([closed('2025-01-15', 100), closed('2026-01-15', 200)], 10_000);
    expect(months.map((m) => m.key)).toEqual(['2025-01', '2026-01']);
  });
});

describe('yearlyReturns', () => {
  it('sums the months it was given, so a row cannot disagree with its own cells', () => {
    const months = monthlyReturns(
      [closed('2026-01-15', 100), closed('2026-02-15', -40), closed('2026-03-15', 60)],
      10_000,
    );
    const years = yearlyReturns(months);

    expect(years).toHaveLength(1);
    expect(years[0]!.net).toBe(months.reduce((sum, m) => sum + m.net, 0));
    expect(years[0]!.trades).toBe(3);
  });

  it('is a compounded return, not the sum of the monthly percentages', () => {
    // +10% then +10% is 21% for the year, not 20%.
    const months = monthlyReturns([closed('2026-01-15', 1000), closed('2026-02-15', 1100)], 10_000);
    const year = yearlyReturns(months)[0]!;

    expect(year.net).toBe(2100);
    expect(year.openingBalance).toBe(10_000);
    expect(year.percent).toBeCloseTo(21, 10);
    expect(year.percent).not.toBeCloseTo(
      months.reduce((sum, m) => sum + (m.percent ?? 0), 0),
      5,
    );
  });

  it('opens each year on the balance it inherited', () => {
    const months = monthlyReturns([closed('2025-06-15', 5000), closed('2026-06-15', 1500)], 10_000);
    const years = yearlyReturns(months);

    expect(years.map((y) => y.year)).toEqual([2025, 2026]);
    expect(years[1]!.openingBalance).toBe(15_000);
    expect(years[1]!.percent).toBeCloseTo(10, 10);
  });

  it('is ordered oldest first', () => {
    const months = monthlyReturns([closed('2026-01-15', 1), closed('2024-01-15', 1)], 1000);
    expect(yearlyReturns(months).map((y) => y.year)).toEqual([2024, 2026]);
  });
});

describe('monthGrid', () => {
  it('gives every year twelve cells, January first', () => {
    const grid = monthGrid(monthlyReturns([closed('2026-07-15', 100)], 10_000));
    expect(grid).toHaveLength(1);
    expect(grid[0]!.months).toHaveLength(12);
    expect(grid[0]!.months[6]!.net).toBe(100);
  });

  it('leaves a month with no trading null rather than zero', () => {
    // "Traded and broke even" and "did not trade" are different facts, and a grid that
    // renders both as ₪0 states the wrong one.
    const grid = monthGrid(monthlyReturns([closed('2026-07-15', 100)], 10_000));
    expect(grid[0]!.months.filter((m) => m === null)).toHaveLength(11);
  });

  it('distinguishes a break-even month from an untraded one', () => {
    const grid = monthGrid(monthlyReturns([closed('2026-07-15', 0)], 10_000));
    expect(grid[0]!.months[6]).not.toBeNull();
    expect(grid[0]!.months[6]!.net).toBe(0);
    expect(grid[0]!.months[6]!.trades).toBe(1);
    expect(grid[0]!.months[5]).toBeNull();
  });

  it('carries the year total beside its cells', () => {
    const grid = monthGrid(
      monthlyReturns([closed('2026-01-15', 100), closed('2026-07-15', -30)], 10_000),
    );
    expect(grid[0]!.total.net).toBe(70);
    const cells = grid[0]!.months.filter((m): m is NonNullable<typeof m> => m !== null);
    expect(cells.reduce((sum, m) => sum + m.net, 0)).toBe(grid[0]!.total.net);
  });

  it('gives a multi-year book a row each, oldest first', () => {
    const grid = monthGrid(
      monthlyReturns([closed('2024-03-15', 10), closed('2026-11-15', 20)], 10_000),
    );
    expect(grid.map((row) => row.year)).toEqual([2024, 2026]);
    expect(grid[0]!.months[2]!.net).toBe(10);
    expect(grid[1]!.months[10]!.net).toBe(20);
  });
});
