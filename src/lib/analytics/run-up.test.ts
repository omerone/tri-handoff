import { describe, expect, it } from 'vitest';
import { equityCurve, maxDrawdown, maxRunUp } from './metrics';
import type { AnalyticsTrade } from './types';

const at = (day: number) => new Date(Date.UTC(2026, 6, day, 12));

const book = (...profits: number[]): AnalyticsTrade[] =>
  profits.map((profit, index) => ({
    id: `t${index}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt: at(index + 1),
    closeAt: at(index + 1),
    profit,
    risk: null,
    rr: null,
    strategy: null,
    tpTiming: null,
    tookOriginalTp: null,
  }));

const curveOf = (start: number, ...profits: number[]) => equityCurve(book(...profits), start);

describe('maximum run-up', () => {
  it('measures the best trough-to-peak stretch, not the total', () => {
    // 10,000 → 9,000 → 12,000 → 11,000. The best run is the 3,000 out of the 9,000 trough,
    // even though the account only finished 1,000 up.
    const curve = curveOf(10_000, -1_000, 3_000, -1_000);
    const result = maxRunUp(curve, 10_000);

    expect(result.maxRunUp).toBe(3_000);
    expect(result.maxRunUpPercent).toBeCloseTo((3_000 / 9_000) * 100);
  });

  it('is not the largest single trade', () => {
    // The biggest winner is 2,000, but three consecutive wins add up to a 3,500 run.
    const curve = curveOf(10_000, 1_000, 2_000, 500);
    expect(maxRunUp(curve, 10_000).maxRunUp).toBe(3_500);
  });

  it('mirrors the drawdown on an inverted book', () => {
    // Flip every trade's sign and the best rise should equal the worst fall of the original.
    const profits = [-500, 1_200, -2_000, 800, -300, 1_500];
    const down = maxDrawdown(curveOf(10_000, ...profits), 10_000);
    const up = maxRunUp(curveOf(10_000, ...profits.map((p) => -p)), 10_000);

    expect(up.maxRunUp).toBeCloseTo(down.maxDrawdown);
  });

  it('reports zero for a book that only ever fell', () => {
    const curve = curveOf(10_000, -500, -500, -500);
    expect(maxRunUp(curve, 10_000).maxRunUp).toBe(0);
  });

  it('holds no opinion about an empty book', () => {
    const result = maxRunUp([], 10_000);
    expect(result.maxRunUp).toBe(0);
    expect(result.troughAt).toBeNull();
    expect(result.peakAt).toBeNull();
  });

  it('names the trough it rose from and the peak it reached', () => {
    const curve = curveOf(10_000, -1_000, 3_000);
    const result = maxRunUp(curve, 10_000);

    expect(result.troughAt).toEqual(at(1));
    expect(result.peakAt).toEqual(at(2));
  });

  it('does not divide by a trough at or below zero', () => {
    // An account wiped out and then funded again has no meaningful base to be a percentage of.
    const curve = curveOf(1_000, -1_000, 5_000);
    const result = maxRunUp(curve, 1_000);

    expect(result.maxRunUp).toBe(5_000);
    expect(result.maxRunUpPercent).toBe(0);
    expect(Number.isFinite(result.maxRunUpPercent)).toBe(true);
  });
});
