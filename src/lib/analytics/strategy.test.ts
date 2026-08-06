import { describe, expect, it } from 'vitest';
import { bestConditions, byStrategy, computeMetrics, UNLABELLED } from './index';
import type { AnalyticsTrade } from './types';

/**
 * The by-strategy dimension answers SPEC §3.5's open question ("לפי אסטרטגיה?"), and it is
 * the only dimension whose buckets come from what the user typed rather than from an enum.
 * That makes the partition invariant worth re-checking here: the other dimensions cover every
 * trade because their key sets are closed, and this one has to earn it.
 */

let counter = 0;
function trade(overrides: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  counter += 1;
  const openAt = overrides.openAt ?? new Date('2026-07-01T09:00:00Z');
  return {
    id: `s${counter}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt,
    closeAt: overrides.closeAt ?? new Date(openAt.getTime() + 3_600_000),
    profit: 100,
    // Costs and size are not what these tests are about; the engine needs them present.
    commission: 0,
    swap: 0,
    volume: 1,
    mae: null,
    mfe: null,
    risk: 100,
    rr: 1,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
    ...overrides,
  };
}

describe('byStrategy', () => {
  const book = [
    trade({ strategy: 'Breakout', profit: 300, rr: 3 }),
    trade({ strategy: 'Breakout', profit: -100, rr: -1 }),
    trade({ strategy: 'Mean reversion', profit: 50, rr: 0.5 }),
    trade({ strategy: null, profit: 20, rr: 0.2 }),
    trade({ strategy: null, profit: -60, rr: -0.6 }),
  ];

  it('groups by the label the trader wrote', () => {
    const buckets = byStrategy(book);
    const breakout = buckets.find((b) => b.key === 'Breakout')!;

    expect(breakout.metrics.count).toBe(2);
    expect(breakout.metrics.net).toBe(200);
  });

  it('keeps unlabelled trades as their own bucket rather than dropping them', () => {
    // Dropping them would make the strategy chart sum to less than the book, with nothing on
    // screen to say so — and a trader comparing two strategies needs to know the comparison
    // rests on 3 trades out of 5.
    const buckets = byStrategy(book);
    const unlabelled = buckets.find((b) => b.key === UNLABELLED)!;

    expect(unlabelled.metrics.count).toBe(2);
    expect(unlabelled.metrics.net).toBe(-40);
  });

  it('INVARIANT: partitions the book like every other dimension', () => {
    const total = computeMetrics(book);
    const buckets = byStrategy(book);

    expect(buckets.reduce((sum, b) => sum + b.metrics.count, 0)).toBe(total.count);
    expect(buckets.reduce((sum, b) => sum + b.metrics.net, 0)).toBeCloseTo(total.net, 6);
    expect(buckets.reduce((sum, b) => sum + b.metrics.wins, 0)).toBe(total.wins);
  });

  it('has no unlabelled bucket when every trade is labelled', () => {
    const labelled = [trade({ strategy: 'Breakout' }), trade({ strategy: 'Scalp' })];
    expect(byStrategy(labelled).map((b) => b.key)).toEqual(['Breakout', 'Scalp']);
  });

  it('sorts named strategies and leaves the unlabelled bucket last', () => {
    const buckets = byStrategy([
      trade({ strategy: 'Zebra' }),
      trade({ strategy: 'Alpha' }),
      trade({ strategy: null }),
    ]);
    expect(buckets.map((b) => b.key)).toEqual(['Alpha', 'Zebra', UNLABELLED]);
  });

  it('is empty for an empty book rather than inventing a bucket', () => {
    expect(byStrategy([])).toEqual([]);
  });
});

describe('strategies in the insights ranking', () => {
  const book = [
    ...Array.from({ length: 6 }, () => trade({ strategy: 'Breakout', profit: 300, rr: 3 })),
    ...Array.from({ length: 6 }, () => trade({ strategy: null, profit: 900, rr: 9 })),
  ];

  it('ranks a named strategy', () => {
    const insights = bestConditions(book, { minTrades: 5, limit: 10 });
    expect(insights.some((i) => i.dimension === 'strategy' && i.key === 'Breakout')).toBe(true);
  });

  it('never ranks "unlabelled", however well those trades did', () => {
    // The unlabelled trades here average 9R and would top the list. "Your best condition is
    // not having written anything down" is not something a trader can act on.
    const insights = bestConditions(book, { minTrades: 5, limit: 10 });
    expect(insights.some((i) => i.key === UNLABELLED)).toBe(false);
  });

  it('leaves the ranking untouched on a book with no strategies at all', () => {
    const plain = Array.from({ length: 6 }, () => trade({ strategy: null }));
    expect(bestConditions(plain).some((i) => i.dimension === 'strategy')).toBe(false);
  });
});
