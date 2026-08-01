import type { AnalyticsTrade, Drawdown, EquityPoint, Metrics } from './types';

/**
 * The metrics, computed from a list of closed trades. Pure — no I/O, no dates beyond the
 * ones on the trades, no configuration.
 *
 * Two conventions run through the whole file and are worth stating once.
 *
 * **A break-even trade is not a win.** `profit > 0` wins, everything else loses. Counting
 * zero as a win would flatter the win rate for anyone who scratches trades often, which is
 * most people. It also keeps `wins + losses === count` exactly, which several of the
 * invariants below rely on.
 *
 * **RR aggregates run over a different population.** A trade with no stop loss has no R
 * multiple, so it is excluded from `avgRr` and counted in `rrCoverage` instead. Every RR
 * figure in the UI is shown with its coverage for that reason — see the note in
 * lib/mt5/risk.ts.
 */

export const EMPTY_METRICS: Metrics = {
  count: 0,
  net: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  grossWin: 0,
  grossLoss: 0,
  profitFactor: 0,
  avgWin: 0,
  avgLoss: 0,
  expectancy: 0,
  avgRr: null,
  rrCoverage: { withRr: 0, total: 0, percent: 0 },
};

export function computeMetrics(trades: readonly AnalyticsTrade[]): Metrics {
  if (trades.length === 0) return EMPTY_METRICS;

  let net = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let rrSum = 0;
  let rrCount = 0;

  for (const trade of trades) {
    net += trade.profit;
    if (trade.profit > 0) {
      wins += 1;
      grossWin += trade.profit;
    } else {
      grossLoss += -trade.profit;
    }
    if (trade.rr !== null) {
      rrSum += trade.rr;
      rrCount += 1;
    }
  }

  const count = trades.length;
  const losses = count - wins;

  return {
    count,
    net,
    wins,
    losses,
    winRate: (wins / count) * 100,
    grossWin,
    grossLoss,
    profitFactor: profitFactorOf(grossWin, grossLoss),
    avgWin: wins > 0 ? grossWin / wins : 0,
    avgLoss: losses > 0 ? grossLoss / losses : 0,
    expectancy: net / count,
    avgRr: rrCount > 0 ? rrSum / rrCount : null,
    rrCoverage: { withRr: rrCount, total: count, percent: (rrCount / count) * 100 },
  };
}

/**
 * Gross win over gross loss.
 *
 * A book with no losses has no finite profit factor. The prototype substituted 99, which
 * reads as a real measurement and would sit in a KPI tile looking like one; `Infinity` is
 * the truth and lets the UI decide to render "∞". With no wins and no losses it is 0.
 */
function profitFactorOf(grossWin: number, grossLoss: number): number {
  if (grossLoss > 0) return grossWin / grossLoss;
  return grossWin > 0 ? Number.POSITIVE_INFINITY : 0;
}

/**
 * Running balance after each trade, in close order.
 *
 * Callers pass the starting balance — for a synced MT5 account that is the deposit total, so
 * the curve begins where the account did rather than at an invented round number.
 */
export function equityCurve(
  trades: readonly AnalyticsTrade[],
  startBalance: number,
): EquityPoint[] {
  let balance = startBalance;
  return trades.map((trade, index) => {
    balance += trade.profit;
    return { index: index + 1, closeAt: trade.closeAt, balance };
  });
}

/**
 * Maximum peak-to-trough decline.
 *
 * Measured against the running peak *including the starting balance*, so an account that
 * loses money from its first trade shows a drawdown rather than nothing. The percentage is
 * of the peak at the time, which is how a trader reads it: losing 2,000 from a 20,000 peak
 * is a 10% drawdown whatever the account is worth now.
 */
export function maxDrawdown(curve: readonly EquityPoint[], startBalance: number): Drawdown {
  let peak = startBalance;
  let peakAt: Date | null = null;
  let worst = 0;
  let worstPercent = 0;
  let bestPeakAt: Date | null = null;
  let troughAt: Date | null = null;

  for (const point of curve) {
    if (point.balance > peak) {
      peak = point.balance;
      peakAt = point.closeAt;
    }
    const decline = peak - point.balance;
    if (decline > worst) {
      worst = decline;
      worstPercent = peak > 0 ? (decline / peak) * 100 : 0;
      bestPeakAt = peakAt;
      troughAt = point.closeAt;
    }
  }

  return {
    maxDrawdown: worst,
    maxDrawdownPercent: worstPercent,
    peakAt: bestPeakAt,
    troughAt,
  };
}
