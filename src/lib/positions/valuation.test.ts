import { describe, expect, it } from 'vitest';
import {
  isStale,
  portfolioTotals,
  realizedPnlOnClose,
  STALE_PRICE_DAYS,
  valuePosition,
  type LongPosition,
} from './valuation';

const NOW = new Date('2026-08-02T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let counter = 0;
function position(overrides: Partial<LongPosition> = {}): LongPosition {
  counter += 1;
  return {
    id: `p${counter}`,
    symbol: 'AAPL',
    qty: 25,
    buyPrice: 182.4,
    buyDate: new Date('2026-01-15T00:00:00Z'),
    currentPrice: 236.1,
    valueUpdatedAt: daysAgo(1),
    fees: 0,
    currency: 'USD',
    realizedPnl: null,
    closedAt: null,
    note: null,
    ...overrides,
  };
}

describe('valuePosition', () => {
  it('values a holding at the last entered price', () => {
    const valuation = valuePosition(position(), NOW);
    expect(valuation.cost).toBeCloseTo(4_560, 6);
    expect(valuation.value).toBeCloseTo(5_902.5, 6);
    expect(valuation.unrealized).toBeCloseTo(1_342.5, 6);
    expect(valuation.unrealizedPercent).toBeCloseTo((1_342.5 / 4_560) * 100, 6);
  });

  it('counts fees as part of the cost', () => {
    // A holding that is level on price but paid commission is down. A P&L that says
    // otherwise flatters the position.
    const withFees = valuePosition(position({ currentPrice: 182.4, fees: 40 }), NOW);
    expect(withFees.unrealized).toBe(-40);
    expect(withFees.cost).toBeCloseTo(4_600, 6);
  });

  it('reports a loss when the price has fallen', () => {
    const valuation = valuePosition(position({ currentPrice: 150 }), NOW);
    expect(valuation.unrealized).toBeLessThan(0);
    expect(valuation.unrealizedPercent).toBeLessThan(0);
  });

  it('measures how old the price is, in whole days', () => {
    expect(valuePosition(position({ valueUpdatedAt: daysAgo(0) }), NOW).priceAgeDays).toBe(0);
    expect(valuePosition(position({ valueUpdatedAt: daysAgo(9) }), NOW).priceAgeDays).toBe(9);
  });

  it('never reports a negative age for a price stamped in the future', () => {
    // Clock skew between the browser and the server should not produce "-1 days ago".
    const future = position({ valueUpdatedAt: new Date(NOW.getTime() + 86_400_000) });
    expect(valuePosition(future, NOW).priceAgeDays).toBe(0);
  });

  it('does not divide by zero on a zero-cost position', () => {
    const free = valuePosition(position({ buyPrice: 0, fees: 0, currentPrice: 10 }), NOW);
    expect(free.unrealizedPercent).toBe(0);
    expect(Number.isNaN(free.unrealizedPercent)).toBe(false);
  });

  it('handles a fractional quantity', () => {
    const btc = position({ symbol: 'BTC', qty: 0.12, buyPrice: 58_200, currentPrice: 104_500 });
    const valuation = valuePosition(btc, NOW);
    expect(valuation.cost).toBeCloseTo(6_984, 6);
    expect(valuation.value).toBeCloseTo(12_540, 6);
  });
});

describe('isStale', () => {
  it('flags a price that has not been touched in a fortnight', () => {
    // The value is only as current as the last time the user typed it, and a net worth built
    // on a three-month-old price should say so.
    expect(isStale(valuePosition(position({ valueUpdatedAt: daysAgo(STALE_PRICE_DAYS) }), NOW))).toBe(true);
    expect(isStale(valuePosition(position({ valueUpdatedAt: daysAgo(STALE_PRICE_DAYS - 1) }), NOW))).toBe(
      false,
    );
  });
});

describe('portfolioTotals', () => {
  const positions = [
    position({ qty: 25, buyPrice: 182.4, currentPrice: 236.1, valueUpdatedAt: daysAgo(5) }),
    position({ symbol: 'QQQ', qty: 10, buyPrice: 418, currentPrice: 512.3, valueUpdatedAt: daysAgo(20) }),
    position({ symbol: 'BTC', qty: 0.12, buyPrice: 58_200, currentPrice: 104_500, valueUpdatedAt: daysAgo(2) }),
  ];

  it('sums cost, value and unrealized across open positions', () => {
    const totals = portfolioTotals(positions, NOW);
    expect(totals.openCount).toBe(3);
    expect(totals.cost).toBeCloseTo(4_560 + 4_180 + 6_984, 6);
    expect(totals.value).toBeCloseTo(5_902.5 + 5_123 + 12_540, 6);
    expect(totals.unrealized).toBeCloseTo(totals.value - totals.cost, 6);
  });

  it('reconciles with the individual valuations', () => {
    const totals = portfolioTotals(positions, NOW);
    const summed = positions.reduce((sum, p) => sum + valuePosition(p, NOW).unrealized, 0);
    expect(totals.unrealized).toBeCloseTo(summed, 6);
  });

  it('reports the stalest open price, not the average', () => {
    // The headline for "how current is this" is the worst case; an average would hide a
    // position nobody has looked at since spring.
    expect(portfolioTotals(positions, NOW).stalestPriceDays).toBe(20);
  });

  it('keeps realized and unrealized apart', () => {
    // One is a position that can still move, the other is money that has landed. A single
    // combined number would mean neither.
    const withClosed = [
      ...positions,
      position({ closedAt: daysAgo(30), realizedPnl: 1_500 }),
      position({ closedAt: daysAgo(10), realizedPnl: -400 }),
    ];
    const totals = portfolioTotals(withClosed, NOW);

    expect(totals.closedCount).toBe(2);
    expect(totals.realized).toBe(1_100);
    // Closed positions contribute nothing to cost or value.
    expect(totals.openCount).toBe(3);
    expect(totals.cost).toBeCloseTo(portfolioTotals(positions, NOW).cost, 6);
  });

  it('is all zeros for an empty portfolio, with no NaN', () => {
    const totals = portfolioTotals([], NOW);
    expect(totals).toMatchObject({ cost: 0, value: 0, unrealized: 0, realized: 0, openCount: 0 });
    for (const value of Object.values(totals)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});

describe('realizedPnlOnClose', () => {
  it('is proceeds minus the cost basis', () => {
    const holding = position({ qty: 25, buyPrice: 182.4, fees: 20 });
    // 25 × 250 − (25 × 182.4 + 20) = 6250 − 4580
    expect(realizedPnlOnClose(holding, 250)).toBeCloseTo(1_670, 6);
  });

  it('is negative on a sale below cost', () => {
    expect(realizedPnlOnClose(position({ qty: 10, buyPrice: 100, fees: 0 }), 90)).toBe(-100);
  });

  it('agrees with the unrealized figure when sold at the last marked price', () => {
    // Closing at the price already on screen should not change the number the user saw.
    const holding = position({ fees: 15 });
    const unrealized = valuePosition(holding, NOW).unrealized;
    expect(realizedPnlOnClose(holding, holding.currentPrice)).toBeCloseTo(unrealized, 6);
  });
});
