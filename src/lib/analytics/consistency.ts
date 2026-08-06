import { zonedDateKey } from '@/lib/time/zone';
import type { AnalyticsTrade, EquityPoint } from './types';

/**
 * The four questions a P&L cannot answer.
 *
 * Every metric already on the analytics screen describes *outcomes* — what was won, how
 * often, at what R. These describe **process**, and they are the ones that separate a trader
 * with an edge from a trader who has been lucky:
 *
 *   - was the risk the same size every time, or does one trade dwarf the rest;
 *   - is the profit spread across the book or sitting in two trades;
 *   - how long was the account under water, not just how deep;
 *   - do the busy days actually earn more than the quiet ones.
 *
 * A trader who risks 1% and then 5% has a win rate that says nothing, because the wins and
 * the losses are not the same size and averaging them is meaningless. A book whose entire
 * profit is one trade has not demonstrated an edge, however good the profit factor looks.
 * Both are invisible in every figure this product showed before.
 *
 * Pure, like the rest of the engine: no I/O, no clock beyond the dates on the trades.
 */

// ---------------------------------------------------------------------------
// Was the risk the same size every time?
// ---------------------------------------------------------------------------

export type RiskConsistency = {
  /** Trades carrying a stop loss. The rest have no risk figure and are excluded, not zeroed. */
  covered: number;
  /** How many trades there were in total, so `covered` can be read as a share. */
  total: number;
  mean: number;
  median: number;
  /** Population standard deviation — this is the whole book, not a sample of it. */
  stdDev: number;
  /**
   * Standard deviation over the mean: the scale-free one.
   *
   * The number to read. It compares a $200-per-trade account with a $20,000 one, and it is
   * the same figure whether the display currency is shekels or dollars. Under about 0.25 is
   * disciplined sizing; over 1.0 means the position size is effectively random.
   *
   * Null when the mean is zero, which can only happen with no covered trades at all.
   */
  variation: number | null;
  min: number;
  max: number;
  /**
   * Share of covered trades whose risk was within `BAND` of the median.
   *
   * The human version of the same fact: "eight out of ten of my trades risked about the same
   * amount" is a sentence a trader can act on, where a coefficient of variation is one they
   * have to look up.
   */
  withinBand: number;
};

/** How far from the median still counts as "the same size". */
export const BAND = 0.25;

export const EMPTY_RISK_CONSISTENCY: RiskConsistency = {
  covered: 0,
  total: 0,
  mean: 0,
  median: 0,
  stdDev: 0,
  variation: null,
  min: 0,
  max: 0,
  withinBand: 0,
};

export function riskConsistency(trades: readonly AnalyticsTrade[]): RiskConsistency {
  const risks = trades
    .map((trade) => trade.risk)
    .filter((risk): risk is number => risk !== null && Number.isFinite(risk) && risk > 0)
    .sort((a, b) => a - b);

  if (risks.length === 0) return { ...EMPTY_RISK_CONSISTENCY, total: trades.length };

  const mean = risks.reduce((sum, risk) => sum + risk, 0) / risks.length;
  const variance =
    risks.reduce((sum, risk) => sum + (risk - mean) ** 2, 0) / risks.length;
  const stdDev = Math.sqrt(variance);
  const median = medianOf(risks);

  const low = median * (1 - BAND);
  const high = median * (1 + BAND);
  const inBand = risks.filter((risk) => risk >= low && risk <= high).length;

  return {
    covered: risks.length,
    total: trades.length,
    mean,
    median,
    stdDev,
    variation: mean > 0 ? stdDev / mean : null,
    min: risks[0]!,
    max: risks[risks.length - 1]!,
    withinBand: (inBand / risks.length) * 100,
  };
}

/** Median of an already-sorted list. Even lengths take the midpoint of the middle pair. */
function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// ---------------------------------------------------------------------------
// Is the profit spread, or is it two trades?
// ---------------------------------------------------------------------------

export type Concentration = {
  net: number;
  /** Gross profit — the winners only, before the losers are taken off. */
  grossWin: number;
  /** How many winners the share below is measured over. */
  topCount: number;
  /**
   * Share of gross profit that came from the biggest `topCount` winners.
   *
   * Null when there were no winners. High is not automatically bad — a trend follower's
   * distribution is *supposed* to be top-heavy — but it changes what the other numbers mean:
   * a profit factor of 2.5 built from one trade is a profit factor of 0.9 without it, and
   * the next hundred trades will find out which.
   */
  topShare: number | null;
  /** The whole book with the single best trade taken out. */
  netWithoutBest: number;
  /** True when removing that one trade turns the book from profitable to losing. */
  restsOnOneTrade: boolean;
};

/** Winners counted in the "top" share. Three is enough to see a distribution's shape. */
export const TOP_WINNERS = 3;

export function concentration(
  trades: readonly AnalyticsTrade[],
  topCount = TOP_WINNERS,
): Concentration {
  const net = trades.reduce((sum, trade) => sum + trade.profit, 0);
  const winners = trades
    .filter((trade) => trade.profit > 0)
    .map((trade) => trade.profit)
    .sort((a, b) => b - a);

  const grossWin = winners.reduce((sum, profit) => sum + profit, 0);
  const top = winners.slice(0, topCount).reduce((sum, profit) => sum + profit, 0);
  const best = winners[0] ?? 0;
  const netWithoutBest = net - best;

  return {
    net,
    grossWin,
    topCount: Math.min(topCount, winners.length),
    topShare: grossWin > 0 ? (top / grossWin) * 100 : null,
    netWithoutBest,
    // Only interesting when the book *is* profitable — a losing book does not rest on anything.
    restsOnOneTrade: net > 0 && netWithoutBest <= 0,
  };
}

// ---------------------------------------------------------------------------
// How long was the account under water?
// ---------------------------------------------------------------------------

export type Underwater = {
  /** Longest stretch below a previous equity peak, in whole days. */
  longestDays: number;
  /** When that stretch began — the peak it fell from. */
  from: Date | null;
  /** When it ended, by getting back above that peak. Null while it never did. */
  recoveredAt: Date | null;
  /** True when the book ends the window still below a previous peak. */
  ongoing: boolean;
  /** Days under water at the end of the window. Zero when it ends at a high. */
  ongoingDays: number;
};

export const EMPTY_UNDERWATER: Underwater = {
  longestDays: 0,
  from: null,
  recoveredAt: null,
  ongoing: false,
  ongoingDays: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Time spent below a previous high, which is the half of a drawdown nobody reports.
 *
 * `maxDrawdown` answers "how far down did it go". This answers "and how long did it stay
 * there" — and that is the one traders actually live through. A 12% drawdown recovered in a
 * fortnight and a 12% drawdown that took nine months are the same number on the KPI tile and
 * completely different experiences; the second is what makes people abandon a working system.
 *
 * Measured from the *peak*, not from the trough: the clock starts when the account was last
 * at a high, because that is when the trader last felt fine.
 */
export function underwater(
  curve: readonly EquityPoint[],
  startBalance: number,
): Underwater {
  if (curve.length === 0) return EMPTY_UNDERWATER;

  let peak = startBalance;
  /*
   * When the account was last at a high, and whether it has been below that high since.
   *
   * `dipped` is the one that stops this measuring the wrong thing. Without it, an account
   * that climbs steadily records a "spell" between every pair of consecutive highs — a book
   * that only ever went up reported its longest drawdown as however far apart its trades
   * were. A stretch counts only if the balance actually fell below the peak in between.
   *
   * `peakAt` is null until the first high *on this curve*: the opening balance is a peak, but
   * it has no date, because it is the state of the account before the window rather than an
   * event in it.
   */
  let peakAt: Date | null = null;
  let dipped = false;
  let longestDays = 0;
  let longestFrom: Date | null = null;
  let recoveredAt: Date | null = null;

  for (const point of curve) {
    if (point.balance < peak) {
      dipped = true;
      continue;
    }

    if (dipped && peakAt !== null) {
      const days = Math.floor((point.closeAt.getTime() - peakAt.getTime()) / DAY_MS);
      if (days > longestDays) {
        longestDays = days;
        longestFrom = peakAt;
        recoveredAt = point.closeAt;
      }
    }
    peak = point.balance;
    peakAt = point.closeAt;
    dipped = false;
  }

  const last = curve[curve.length - 1]!;
  const ongoing = last.balance < peak;
  /*
   * With no dated peak the account has been under water since before the window opened, so
   * the spell is measured from the first point in it. That under-reports — the real spell
   * started earlier — which is the right direction to be wrong in, and better than the zero
   * that a missing date would otherwise produce for someone who never recovered a deposit.
   */
  const measuredFrom = peakAt ?? curve[0]!.closeAt;
  const ongoingDays = ongoing
    ? Math.floor((last.closeAt.getTime() - measuredFrom.getTime()) / DAY_MS)
    : 0;

  /*
   * A spell that has not ended yet still counts, and can be the longest one. Reporting only
   * completed recoveries would say "longest drawdown: 4 days" to someone who has been under
   * water for seven months, which is precisely backwards.
   */
  if (ongoingDays > longestDays) {
    return {
      longestDays: ongoingDays,
      from: measuredFrom,
      recoveredAt: null,
      ongoing: true,
      ongoingDays,
    };
  }

  return { longestDays, from: longestFrom, recoveredAt, ongoing, ongoingDays };
}

// ---------------------------------------------------------------------------
// Do the busy days earn more?
// ---------------------------------------------------------------------------

export type DayLoad = {
  /** Trades closed on a day. */
  trades: number;
  /** How many days in the window had exactly this many. */
  days: number;
  net: number;
  /** Mean net on a day with this many trades — the number the chart plots. */
  avgNet: number;
  wins: number;
  winRate: number;
};

/**
 * P&L against how many trades were taken that day.
 *
 * The overtrading question, asked in the only way that answers it. Almost every discretionary
 * trader has a load beyond which the day turns negative — the first two trades are the setups
 * they waited for and the next five are boredom, revenge, or trying to get it back. It never
 * appears in a per-trade average, because the good trades and the bad ones are averaged
 * together; splitting by the day's *count* separates the sessions where the discipline held
 * from the ones where it did not.
 *
 * Days rather than sessions, and close date rather than open, matching `dailyTotals` and the
 * calendar so the two screens cannot disagree about which day a trade belongs to.
 */
export function dayLoads(trades: readonly AnalyticsTrade[]): DayLoad[] {
  const byDay = new Map<string, { net: number; count: number; wins: number }>();

  for (const trade of trades) {
    const key = zonedDateKey(trade.closeAt);
    const day = byDay.get(key) ?? { net: 0, count: 0, wins: 0 };
    day.net += trade.profit;
    day.count += 1;
    if (trade.profit > 0) day.wins += 1;
    byDay.set(key, day);
  }

  const byLoad = new Map<number, { days: number; net: number; trades: number; wins: number }>();
  for (const day of byDay.values()) {
    const load = byLoad.get(day.count) ?? { days: 0, net: 0, trades: 0, wins: 0 };
    load.days += 1;
    load.net += day.net;
    load.trades += day.count;
    load.wins += day.wins;
    byLoad.set(day.count, load);
  }

  return [...byLoad.entries()]
    .map(([trades_, load]) => ({
      trades: trades_,
      days: load.days,
      net: load.net,
      avgNet: load.net / load.days,
      wins: load.wins,
      winRate: load.trades > 0 ? (load.wins / load.trades) * 100 : 0,
    }))
    .sort((a, b) => a.trades - b.trades);
}
