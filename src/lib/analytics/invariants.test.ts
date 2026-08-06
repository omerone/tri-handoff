import { describe, expect, it } from 'vitest';
import { generateMockDeals } from '@/lib/mt5/mock/generator';
import { computeRr } from '@/lib/mt5/risk';
import { classifySymbol } from '@/lib/mt5/symbols';
import { MOCK_ACCOUNT_CURRENCY, MOCK_QUOTE_RATES } from '@/lib/mt5/mock/generator';
import { sameZonedDay, wallClock, zonedDateKey } from '@/lib/time/zone';
import {
  bestConditions,
  byAssetClass,
  byDirection,
  byHour,
  bySession,
  byStyle,
  bySymbol,
  byWeekday,
  computeMetrics,
  dailyTotals,
  equityCurve,
  heatmap,
  maxDrawdown,
} from './index';
import { computeCosts, costsBySymbol } from './costs';
import { concentration, dayLoads, riskConsistency, underwater } from './consistency';
import { monthGrid, monthlyReturns } from './periods';
import type { AnalyticsTrade } from './types';

/**
 * The invariants the brief calls out, plus the ones that caught real bugs in the prototype.
 *
 * These are properties rather than expected values on purpose. A metric that is subtly wrong
 * still produces a plausible number, sits in a KPI tile, and gets acted on; what it cannot do
 * is keep satisfying "every dimension's buckets sum to the total" or "drawdown equals a
 * brute-force search over every pair of points". Checking the properties catches the class of
 * bug, not one instance of it.
 *
 * The fixture is the seeded mock book — 92 trades with a deliberate edge built into
 * particular weekdays, sessions and asset classes — run through the same RR rule the sync
 * uses.
 */

const START_BALANCE = 10_000;

const FIXTURE: AnalyticsTrade[] = generateMockDeals()
  .deals.filter((deal) => deal.kind === 'trade' && deal.closeAt !== null)
  .map((deal, index) => {
    const { risk, rr } = computeRr(deal, {
      accountCurrency: MOCK_ACCOUNT_CURRENCY,
      quoteRates: MOCK_QUOTE_RATES,
    });
    return {
      id: `t${index}`,
      symbol: deal.symbol,
      assetClass: classifySymbol(deal.symbol),
      direction: deal.direction,
      style: sameZonedDay(deal.openAt, deal.closeAt!) ? 'day' : 'swing',
      openAt: deal.openAt,
      closeAt: deal.closeAt!,
      profit: deal.profit + deal.commission + deal.swap,
      // The broker's own signed figures, carried through exactly as `sync.ts` stores them —
      // so the costs invariants below are checked against real fixture money rather than
      // against zeroes.
      commission: deal.commission,
      swap: deal.swap,
      volume: deal.volume,
      risk,
      rr,
      mae: null,
      mfe: null,
      // The mock book is un-journalled, which is the honest default: a freshly synced
      // account has no strategies on it until the trader writes them.
      strategy: null,
      rating: null,
      mood: null,
      tpTiming: null,
      tookOriginalTp: null,
    } satisfies AnalyticsTrade;
  });

const near = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) < epsilon;

describe('the fixture is worth testing against', () => {
  it('has enough trades, on both sides, across several classes', () => {
    expect(FIXTURE.length).toBe(92);
    expect(FIXTURE.some((t) => t.profit > 0)).toBe(true);
    expect(FIXTURE.some((t) => t.profit < 0)).toBe(true);
    expect(new Set(FIXTURE.map((t) => t.assetClass)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(FIXTURE.map((t) => t.direction)).size).toBe(2);
  });

  it('is deterministic', () => {
    const again = generateMockDeals().deals.filter((d) => d.kind === 'trade');
    expect(again.map((d) => d.profit)).toEqual(
      generateMockDeals()
        .deals.filter((d) => d.kind === 'trade')
        .map((d) => d.profit),
    );
  });
});

describe('INVARIANT: every dimension partitions the book', () => {
  const total = computeMetrics(FIXTURE);

  const dimensions = {
    weekday: byWeekday(FIXTURE),
    hour: byHour(FIXTURE),
    session: bySession(FIXTURE),
    direction: byDirection(FIXTURE),
    assetClass: byAssetClass(FIXTURE),
    style: byStyle(FIXTURE),
    symbol: bySymbol(FIXTURE),
  };

  for (const [name, buckets] of Object.entries(dimensions)) {
    describe(name, () => {
      it('sums to the total net P&L exactly', () => {
        const summed = buckets.reduce((sum, b) => sum + b.metrics.net, 0);
        // Exactly: if a bucket's P&L went missing, one bar on the analytics page would be
        // wrong and there would be no way to see it.
        expect(near(summed, total.net)).toBe(true);
      });

      it('sums to the total trade count', () => {
        expect(buckets.reduce((sum, b) => sum + b.metrics.count, 0)).toBe(total.count);
      });

      it('sums to the total wins and losses', () => {
        expect(buckets.reduce((sum, b) => sum + b.metrics.wins, 0)).toBe(total.wins);
        expect(buckets.reduce((sum, b) => sum + b.metrics.losses, 0)).toBe(total.losses);
      });

      it('sums to the total gross win and gross loss', () => {
        expect(near(buckets.reduce((s, b) => s + b.metrics.grossWin, 0), total.grossWin)).toBe(true);
        expect(near(buckets.reduce((s, b) => s + b.metrics.grossLoss, 0), total.grossLoss)).toBe(
          true,
        );
      });

      it('sums to the total RR coverage', () => {
        expect(buckets.reduce((sum, b) => sum + b.metrics.rrCoverage.withRr, 0)).toBe(
          total.rrCoverage.withRr,
        );
      });
    });
  }

  it('covers the weekdays the market is open — no trade falls outside a bucket', () => {
    // The Mon–Fri buckets only partition the book because the generator never opens a trade
    // at the weekend. If that ever changed, the sum invariants above would catch it.
    expect(FIXTURE.every((t) => [1, 2, 3, 4, 5].includes(wallClock(t.openAt).weekday))).toBe(true);
  });
});

describe('INVARIANT: win rate is a percentage', () => {
  it('stays within [0, 100] for the whole book and every bucket', () => {
    const everyBucket = [
      computeMetrics(FIXTURE),
      ...byWeekday(FIXTURE).map((b) => b.metrics),
      ...bySession(FIXTURE).map((b) => b.metrics),
      ...byAssetClass(FIXTURE).map((b) => b.metrics),
      ...byDirection(FIXTURE).map((b) => b.metrics),
      ...byStyle(FIXTURE).map((b) => b.metrics),
      ...bySymbol(FIXTURE).map((b) => b.metrics),
    ];

    for (const metrics of everyBucket) {
      expect(metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(metrics.winRate).toBeLessThanOrEqual(100);
      expect(metrics.rrCoverage.percent).toBeGreaterThanOrEqual(0);
      expect(metrics.rrCoverage.percent).toBeLessThanOrEqual(100);
    }
  });

  it('is exactly wins over count', () => {
    const m = computeMetrics(FIXTURE);
    expect(near(m.winRate, (m.wins / m.count) * 100)).toBe(true);
    expect(m.wins + m.losses).toBe(m.count);
  });

  it('counts a break-even trade as a loss, not a win', () => {
    const metrics = computeMetrics([trade({ profit: 0 }), trade({ profit: 10 })]);
    expect(metrics.wins).toBe(1);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRate).toBe(50);
  });
});

describe('INVARIANT: profit factor is grossWin / grossLoss', () => {
  it('holds on the fixture', () => {
    const m = computeMetrics(FIXTURE);
    expect(near(m.profitFactor, m.grossWin / m.grossLoss)).toBe(true);
  });

  it('holds for every bucket that has both a win and a loss', () => {
    for (const bucket of [...byAssetClass(FIXTURE), ...bySession(FIXTURE), ...byWeekday(FIXTURE)]) {
      const m = bucket.metrics;
      if (m.grossLoss > 0) expect(near(m.profitFactor, m.grossWin / m.grossLoss)).toBe(true);
    }
  });

  it('is infinite rather than a made-up 99 when there are no losses', () => {
    // The prototype used 99, which reads as a measurement. Infinity lets the UI render "∞".
    const metrics = computeMetrics([trade({ profit: 100 }), trade({ profit: 50 })]);
    expect(metrics.profitFactor).toBe(Number.POSITIVE_INFINITY);
  });

  it('is zero when there is nothing to divide', () => {
    expect(computeMetrics([trade({ profit: 0 })]).profitFactor).toBe(0);
  });
});

describe('INVARIANT: drawdown matches a brute-force reference', () => {
  /** The definition, computed the slow, obviously-correct way: every peak, every later trough. */
  function bruteForceDrawdown(balances: number[]): number {
    let worst = 0;
    for (let i = 0; i < balances.length; i++) {
      for (let j = i + 1; j < balances.length; j++) {
        worst = Math.max(worst, balances[i]! - balances[j]!);
      }
    }
    return worst;
  }

  it('agrees on the fixture', () => {
    const curve = equityCurve(FIXTURE, START_BALANCE);
    const balances = [START_BALANCE, ...curve.map((p) => p.balance)];
    expect(near(maxDrawdown(curve, START_BALANCE).maxDrawdown, bruteForceDrawdown(balances))).toBe(
      true,
    );
  });

  it('agrees on every prefix of the fixture', () => {
    // A single comparison could pass by luck; 92 of them across growing books could not.
    for (let length = 1; length <= FIXTURE.length; length++) {
      const slice = FIXTURE.slice(0, length);
      const curve = equityCurve(slice, START_BALANCE);
      const balances = [START_BALANCE, ...curve.map((p) => p.balance)];
      expect(near(maxDrawdown(curve, START_BALANCE).maxDrawdown, bruteForceDrawdown(balances))).toBe(
        true,
      );
    }
  });

  it('counts a decline from the starting balance', () => {
    // Measured against a peak that includes the opening balance, so an account that loses
    // from its first trade shows a drawdown rather than zero.
    const curve = equityCurve([trade({ profit: -500 })], START_BALANCE);
    expect(maxDrawdown(curve, START_BALANCE).maxDrawdown).toBe(500);
  });

  it('is zero for a book that only goes up', () => {
    const curve = equityCurve([trade({ profit: 100 }), trade({ profit: 50 })], START_BALANCE);
    expect(maxDrawdown(curve, START_BALANCE).maxDrawdown).toBe(0);
  });

  it('reports the percentage against the peak at the time', () => {
    const trades = [trade({ profit: 10_000 }), trade({ profit: -2_000 })];
    const curve = equityCurve(trades, START_BALANCE);
    const dd = maxDrawdown(curve, START_BALANCE);
    // 2,000 off a 20,000 peak is 10%, whatever the account is worth now.
    expect(dd.maxDrawdown).toBe(2_000);
    expect(near(dd.maxDrawdownPercent, 10)).toBe(true);
  });
});

describe('INVARIANT: the equity curve reconciles with net P&L', () => {
  it('ends at start balance plus net', () => {
    const curve = equityCurve(FIXTURE, START_BALANCE);
    expect(near(curve.at(-1)!.balance, START_BALANCE + computeMetrics(FIXTURE).net)).toBe(true);
  });

  it('steps by exactly one trade each point, in close order', () => {
    const curve = equityCurve(FIXTURE, START_BALANCE);
    expect(curve).toHaveLength(FIXTURE.length);

    let previous = START_BALANCE;
    curve.forEach((point, index) => {
      expect(point.index).toBe(index + 1);
      expect(near(point.balance - previous, FIXTURE[index]!.profit)).toBe(true);
      previous = point.balance;
    });
  });

  it('is empty for an empty book', () => {
    expect(equityCurve([], START_BALANCE)).toEqual([]);
    expect(maxDrawdown([], START_BALANCE).maxDrawdown).toBe(0);
  });
});

describe('INVARIANT: RR aggregates exclude trades with no stop loss', () => {
  it('averages only over the trades that have an R multiple', () => {
    const mixed = [
      trade({ profit: 100, risk: 100, rr: 1 }),
      trade({ profit: 300, risk: 100, rr: 3 }),
      trade({ profit: 500, risk: null, rr: null }),
    ];
    const metrics = computeMetrics(mixed);

    // 2, not 1.33 — the stop-less trade is excluded rather than counted as 0R.
    expect(metrics.avgRr).toBe(2);
    expect(metrics.rrCoverage).toEqual({ withRr: 2, total: 3, percent: (2 / 3) * 100 });
    // But its money still counts toward P&L.
    expect(metrics.net).toBe(900);
    expect(metrics.count).toBe(3);
  });

  it('is null, not zero, when no trade has a stop loss', () => {
    const metrics = computeMetrics([trade({ profit: 100, risk: null, rr: null })]);
    expect(metrics.avgRr).toBeNull();
    expect(metrics.rrCoverage.percent).toBe(0);
  });

  it('reports full coverage on the mock book', () => {
    const metrics = computeMetrics(FIXTURE);
    expect(metrics.rrCoverage.withRr).toBe(FIXTURE.length);
    expect(metrics.avgRr).not.toBeNull();
  });
});

describe('INVARIANT: a day trade never spans two calendar days', () => {
  it('holds for every day trade in the fixture', () => {
    for (const t of FIXTURE.filter((t) => t.style === 'day')) {
      expect(zonedDateKey(t.openAt)).toBe(zonedDateKey(t.closeAt));
    }
  });

  it('puts every day trade on exactly one calendar square', () => {
    const days = dailyTotals(FIXTURE);
    const totalCounted = [...days.values()].reduce((sum, day) => sum + day.count, 0);
    expect(totalCounted).toBe(FIXTURE.length);
  });

  it('groups the calendar by close date, so a swing trade counts on the day it paid', () => {
    const swing = trade({
      openAt: new Date('2026-07-01T08:00:00Z'),
      closeAt: new Date('2026-07-04T08:00:00Z'),
      profit: 250,
    });
    const days = dailyTotals([swing]);
    expect([...days.keys()]).toEqual([zonedDateKey(swing.closeAt)]);
    expect(days.get(zonedDateKey(swing.closeAt))!.net).toBe(250);
  });

  it('reconciles daily totals with net P&L', () => {
    const summed = [...dailyTotals(FIXTURE).values()].reduce((sum, day) => sum + day.net, 0);
    expect(near(summed, computeMetrics(FIXTURE).net)).toBe(true);
  });
});

describe('heatmap', () => {
  it('always renders a full 5 × 3 grid', () => {
    const cells = heatmap(FIXTURE);
    expect(cells).toHaveLength(15);
    expect(new Set(cells.map((c) => `${c.weekday}:${c.session}`)).size).toBe(15);
  });

  it('sums to the total, so no trade is dropped between the squares', () => {
    const cells = heatmap(FIXTURE);
    expect(near(cells.reduce((s, c) => s + c.net, 0), computeMetrics(FIXTURE).net)).toBe(true);
    expect(cells.reduce((s, c) => s + c.count, 0)).toBe(FIXTURE.length);
  });
});

describe('best conditions ranking', () => {
  it('drops buckets with too few trades to mean anything', () => {
    const insights = bestConditions(FIXTURE, { minTrades: 5 });
    expect(insights.every((i) => i.metrics.count >= 5)).toBe(true);
  });

  it('ranks by average R, highest first', () => {
    const insights = bestConditions(FIXTURE);
    const rrs = insights.map((i) => i.metrics.avgRr!);
    expect([...rrs].sort((a, b) => b - a)).toEqual(rrs);
  });

  it('ranks by R rather than net, so the busiest bucket does not simply win', () => {
    const busy = Array.from({ length: 20 }, () => trade({ profit: 100, risk: 200, rr: 0.5 }));
    const sharp = Array.from({ length: 6 }, () =>
      trade({ profit: 300, risk: 100, rr: 3, direction: 'short' }),
    );
    const insights = bestConditions([...busy, ...sharp], { minTrades: 5, limit: 10 });

    const short = insights.find((i) => i.dimension === 'direction' && i.key === 'short');
    const long = insights.find((i) => i.dimension === 'direction' && i.key === 'long');
    // Long made more money in total; short is the better condition.
    expect(short!.metrics.avgRr!).toBeGreaterThan(long!.metrics.avgRr!);
    expect(insights.indexOf(short!)).toBeLessThan(insights.indexOf(long!));
  });

  it('finds the edge the generator deliberately built in', () => {
    // The mock gives Tuesday and Wednesday a higher win probability. If the weekday
    // dimension were mis-bucketed, this would not show up.
    const weekdays = byWeekday(FIXTURE);
    const midweek = weekdays.filter((b) => b.key === '2' || b.key === '3');
    const rest = weekdays.filter((b) => b.key !== '2' && b.key !== '3');
    const avg = (bs: typeof weekdays) =>
      bs.reduce((s, b) => s + b.metrics.winRate, 0) / (bs.length || 1);

    expect(avg(midweek)).toBeGreaterThan(avg(rest));
  });

  it('returns nothing for an empty book rather than throwing', () => {
    expect(bestConditions([])).toEqual([]);
  });
});

describe('empty and degenerate books', () => {
  it('reports zeros rather than NaN', () => {
    const metrics = computeMetrics([]);
    expect(metrics.count).toBe(0);
    expect(metrics.net).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.expectancy).toBe(0);
    expect(metrics.avgRr).toBeNull();
    for (const value of Object.values(metrics)) {
      if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
    }
  });

  it('produces no NaN anywhere on the fixture', () => {
    const metrics = computeMetrics(FIXTURE);
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        expect(Number.isNaN(value), `${key} is NaN`).toBe(false);
      }
    }
  });

  it('handles a single trade', () => {
    const metrics = computeMetrics([trade({ profit: 42, risk: 21, rr: 2 })]);
    expect(metrics).toMatchObject({ count: 1, net: 42, wins: 1, winRate: 100, avgRr: 2 });
    expect(metrics.expectancy).toBe(42);
  });
});

describe('expectancy', () => {
  it('is mean net profit per trade', () => {
    const m = computeMetrics(FIXTURE);
    expect(near(m.expectancy, m.net / m.count)).toBe(true);
  });

  it('reconciles with average win, average loss and win rate', () => {
    // The textbook identity: E = p(win)·avgWin − p(loss)·avgLoss.
    const m = computeMetrics(FIXTURE);
    const identity = (m.wins / m.count) * m.avgWin - (m.losses / m.count) * m.avgLoss;
    expect(near(m.expectancy, identity, 1e-9)).toBe(true);
  });
});

describe('INVARIANT: costs reconcile with the net every other screen shows', () => {
  const costs = computeCosts(FIXTURE);

  it('gross minus costs is net, on the real fixture book', () => {
    const net = FIXTURE.reduce((sum, trade) => sum + trade.profit, 0);
    expect(near(costs.net, net, 1e-9)).toBe(true);
    expect(near(costs.gross - costs.total, costs.net, 1e-9)).toBe(true);
  });

  it('the fixture actually charges commission, so this is not testing zeroes', () => {
    expect(costs.total).toBeGreaterThan(0);
  });

  it('the per-symbol split sums to the whole', () => {
    const parts = costsBySymbol(FIXTURE);
    expect(near(parts.reduce((sum, b) => sum + b.costs.total, 0), costs.total, 1e-9)).toBe(true);
    expect(near(parts.reduce((sum, b) => sum + b.costs.net, 0), costs.net, 1e-9)).toBe(true);
  });
});

describe('INVARIANT: the process figures agree with the book they describe', () => {
  it('risk dispersion covers exactly the trades that carry a stop', () => {
    const spread = riskConsistency(FIXTURE);
    const withStop = FIXTURE.filter((t) => t.risk !== null && t.risk > 0).length;
    expect(spread.covered).toBe(withStop);
    expect(spread.total).toBe(FIXTURE.length);
    // The same population the RR aggregates run over — see the RR invariant above.
    expect(spread.covered).toBe(computeMetrics(FIXTURE).rrCoverage.withRr);
  });

  it('concentration reports the same net as the metrics do', () => {
    const spread = concentration(FIXTURE);
    expect(near(spread.net, computeMetrics(FIXTURE).net, 1e-9)).toBe(true);
    expect(near(spread.grossWin, computeMetrics(FIXTURE).grossWin, 1e-9)).toBe(true);
  });

  it('the day loads account for every trade in the book', () => {
    const loads = dayLoads(FIXTURE);
    const counted = loads.reduce((sum, load) => sum + load.trades * load.days, 0);
    expect(counted).toBe(FIXTURE.length);
    expect(near(loads.reduce((sum, load) => sum + load.net, 0), computeMetrics(FIXTURE).net, 1e-9)).toBe(true);
  });

  it('the months partition the book and sum to its net', () => {
    const months = monthlyReturns(FIXTURE, 10_000);
    expect(months.reduce((sum, m) => sum + m.trades, 0)).toBe(FIXTURE.length);
    expect(near(months.reduce((sum, m) => sum + m.net, 0), computeMetrics(FIXTURE).net, 1e-9)).toBe(
      true,
    );
  });

  it('a year row equals its own twelve cells', () => {
    // The discrepancy nobody notices until a client does: a total computed from the trades
    // while the cells are computed from the months.
    for (const row of monthGrid(monthlyReturns(FIXTURE, 10_000))) {
      const cells = row.months.filter((m): m is NonNullable<typeof m> => m !== null);
      expect(near(cells.reduce((sum, m) => sum + m.net, 0), row.total.net, 1e-9)).toBe(true);
      expect(cells.reduce((sum, m) => sum + m.trades, 0)).toBe(row.total.trades);
    }
  });

  it('time under water never exceeds the span of the book', () => {
    const curve = equityCurve(FIXTURE, 10_000);
    const spell = underwater(curve, 10_000);
    const spanDays =
      (FIXTURE[FIXTURE.length - 1]!.closeAt.getTime() - FIXTURE[0]!.closeAt.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(spell.longestDays).toBeGreaterThanOrEqual(0);
    expect(spell.longestDays).toBeLessThanOrEqual(Math.ceil(spanDays));
  });
});

// --- helpers ----------------------------------------------------------------

let counter = 0;

function trade(overrides: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  counter += 1;
  const openAt = overrides.openAt ?? new Date('2026-07-01T09:00:00Z');
  return {
    id: `x${counter}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt,
    closeAt: overrides.closeAt ?? new Date(openAt.getTime() + 3_600_000),
    profit: 0,
    // Costs and size are not what these invariants are about; the engine needs them present.
    commission: 0,
    swap: 0,
    volume: 1,
    mae: null,
    mfe: null,
    risk: 100,
    rr: 0,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
    ...overrides,
  };
}
