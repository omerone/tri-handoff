import { describe, expect, it } from 'vitest';
import { computeCosts, costOf, costsBySymbol, costsByStyle, EMPTY_COSTS, grossOf } from './costs';
import type { AnalyticsTrade } from './types';

/**
 * The one thing to keep straight in this file: MT5's sign convention.
 *
 * `commission` and `swap` are stored exactly as the broker reports them — negative is money
 * out — and `sync.ts` adds both to the gross to produce the stored `profit`. So a trade whose
 * gross was 200 with 14 of commission and 2 of swap is stored as `profit: 184, commission:
 * -14, swap: -2`. Every fixture below is built that way round, because a test that invented
 * its own convention would pass while the screen showed the costs as a credit.
 */

let seq = 0;

/** `gross` is what the trade made before costs; the fixture derives `profit` from it. */
function trade(over: {
  gross: number;
  commission?: number;
  swap?: number;
  symbol?: string;
  style?: AnalyticsTrade['style'];
}): AnalyticsTrade {
  const commission = over.commission ?? 0;
  const swap = over.swap ?? 0;
  seq += 1;
  return {
    id: `t${seq}`,
    symbol: over.symbol ?? 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: over.style ?? 'day',
    openAt: new Date('2026-07-01T10:00:00Z'),
    closeAt: new Date('2026-07-01T14:00:00Z'),
    profit: over.gross + commission + swap,
    commission,
    swap,
    volume: 1,
    risk: null,
    rr: null,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
  };
}

describe('grossOf and costOf', () => {
  it('undoes what the sync did', () => {
    const t = trade({ gross: 200, commission: -14, swap: -2 });
    expect(t.profit).toBe(184);
    expect(grossOf(t)).toBe(200);
    expect(costOf(t)).toBe(16);
  });

  it('reports earned carry as a negative cost rather than as a charge', () => {
    // A positive swap is money in. Flipping its sign blindly would report it as a cost.
    const t = trade({ gross: 100, commission: -5, swap: 3 });
    expect(costOf(t)).toBe(2);
    expect(grossOf(t)).toBe(100);
  });

  it('is zero for a trade that cost nothing', () => {
    expect(costOf(trade({ gross: 50 }))).toBe(0);
  });
});

describe('computeCosts', () => {
  it('is empty for an empty book', () => {
    expect(computeCosts([])).toEqual(EMPTY_COSTS);
  });

  it('reports costs as money paid, not as negative numbers', () => {
    const costs = computeCosts([
      trade({ gross: 200, commission: -14, swap: -2 }),
      trade({ gross: 100, commission: -7, swap: -1 }),
    ]);

    expect(costs.commission).toBe(21);
    expect(costs.swap).toBe(3);
    expect(costs.total).toBe(24);
  });

  it('reconciles: gross minus costs is the net every other screen shows', () => {
    const book = [
      trade({ gross: 200, commission: -14, swap: -2 }),
      trade({ gross: -80, commission: -7, swap: 1 }),
      trade({ gross: 40, commission: -3 }),
    ];
    const costs = computeCosts(book);

    expect(costs.net).toBe(book.reduce((sum, t) => sum + t.profit, 0));
    expect(costs.gross - costs.total).toBeCloseTo(costs.net, 10);
  });

  it('measures the share against gross profit', () => {
    // Grossed 1,000, paid 100 — a tenth of what the strategy made went to the broker.
    const costs = computeCosts([trade({ gross: 1000, commission: -100 })]);
    expect(costs.gross).toBe(1000);
    expect(costs.shareOfGross).toBeCloseTo(10, 10);
  });

  it('has no share to report when the book did not gross a profit', () => {
    // A percentage of a negative base reads as the opposite of what it means.
    const costs = computeCosts([trade({ gross: -500, commission: -20 })]);
    expect(costs.gross).toBe(-500);
    expect(costs.shareOfGross).toBeNull();
    expect(costs.total).toBe(20);
  });

  it('counts the trades that costs turned from winners into losers', () => {
    const costs = computeCosts([
      // Won 5, paid 8 — the trade was right and the position still lost money.
      trade({ gross: 5, commission: -8 }),
      // Won 50, paid 8 — still a winner.
      trade({ gross: 50, commission: -8 }),
      // Lost before costs too; costs did not turn it, it was already losing.
      trade({ gross: -30, commission: -8 }),
      // Exactly break-even after costs: it was a winner before them, so it counts.
      trade({ gross: 8, commission: -8 }),
    ]);

    expect(costs.turnedLosing).toBe(2);
  });

  it('averages over trades, not over days', () => {
    const costs = computeCosts([
      trade({ gross: 10, commission: -4 }),
      trade({ gross: 10, commission: -6 }),
    ]);
    expect(costs.perTrade).toBe(5);
  });
});

describe('grouping', () => {
  it('orders by what was spent, so the expensive instrument is first', () => {
    const buckets = costsBySymbol([
      trade({ symbol: 'EURUSD', gross: 10, commission: -2 }),
      trade({ symbol: 'GOLD', gross: 10, commission: -50 }),
      trade({ symbol: 'BTC', gross: 10, commission: -20 }),
    ]);

    expect(buckets.map((b) => b.key)).toEqual(['GOLD', 'BTC', 'EURUSD']);
    expect(buckets[0]!.costs.total).toBe(50);
  });

  it('keeps a group that cost nothing', () => {
    // Commission-free is information, not an absence.
    const buckets = costsBySymbol([
      trade({ symbol: 'EURUSD', gross: 10, commission: -5 }),
      trade({ symbol: 'FREE', gross: 10 }),
    ]);
    expect(buckets.map((b) => b.key)).toContain('FREE');
    expect(buckets.find((b) => b.key === 'FREE')!.costs.total).toBe(0);
  });

  it('splits swing from day, which is where swap actually lands', () => {
    const buckets = costsByStyle([
      trade({ style: 'day', gross: 10, commission: -5, swap: 0 }),
      trade({ style: 'swing', gross: 10, commission: -5, swap: -40 }),
    ]);

    const swing = buckets.find((b) => b.key === 'swing')!;
    const day = buckets.find((b) => b.key === 'day')!;
    expect(swing.costs.swap).toBe(40);
    expect(day.costs.swap).toBe(0);
  });

  it('the groups sum to the whole', () => {
    const book = [
      trade({ symbol: 'EURUSD', gross: 200, commission: -14, swap: -2 }),
      trade({ symbol: 'GOLD', gross: -80, commission: -7, swap: 1 }),
      trade({ symbol: 'GOLD', gross: 40, commission: -3 }),
    ];
    const whole = computeCosts(book);
    const parts = costsBySymbol(book);

    expect(parts.reduce((sum, b) => sum + b.costs.total, 0)).toBeCloseTo(whole.total, 10);
    expect(parts.reduce((sum, b) => sum + b.costs.net, 0)).toBeCloseTo(whole.net, 10);
  });
});
