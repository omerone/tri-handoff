import type { AnalyticsTrade } from './types';

/**
 * What MAE and MFE add up to across a book.
 *
 * Per trade the two numbers are interesting; across a hundred trades they answer two
 * questions a trader cannot otherwise settle, and both of them are about *rules* rather than
 * about any single trade:
 *
 *   - **Is the stop in the right place?** Measured against risk. A book whose winners never
 *     came within half their stop is a book risking more per trade than it needs to; one
 *     whose winners were regularly grazed is a book one bad fill from giving them back. The
 *     figure to read is the MAE of the *winners* — the losers all reached their stop by
 *     definition, so including them measures nothing but the stop itself.
 *   - **How much is being left on the table?** Measured against what was actually taken. The
 *     gap between the best price a trade saw and the price it closed at, summed, is the cost
 *     of every early exit — and it is the only honest input to "would a trailing stop help".
 *
 * Nulls are excluded and counted, never treated as zero, exactly as `rr` is. Coverage is
 * reported alongside every figure for the same reason RR coverage is: an average computed
 * from three trades must not be able to masquerade as one computed from three hundred.
 */

export type Excursions = {
  /** Trades with both an excursion and a risk to measure it against. */
  covered: number;
  total: number;
  coveragePercent: number;
  /**
   * Mean MAE of the winners, as a fraction of their risk.
   *
   * Winners only, and this is the whole point of the metric. Every loser reached its stop —
   * that is what made it a loser — so folding them in measures the stop distance rather than
   * how much heat the trades took. Null when no winner had both figures.
   */
  winnerHeat: number | null;
  /** Winners that at some point traded past their own stop distance and came back. */
  winnersThroughStop: number;
  /**
   * Mean of `profit / mfe` over the winners: what fraction of the best available move was
   * actually captured. 1.0 means exiting at the high every time, which nobody does; a book
   * sitting at 0.3 is a book with an exit problem rather than an entry one.
   */
  capture: number | null;
  /** Money that was on the table at the best moment and not taken, summed over the winners. */
  leftOnTable: number;
};

export const EMPTY_EXCURSIONS: Excursions = {
  covered: 0,
  total: 0,
  coveragePercent: 0,
  winnerHeat: null,
  winnersThroughStop: 0,
  capture: null,
  leftOnTable: 0,
};

export function computeExcursions(trades: readonly AnalyticsTrade[]): Excursions {
  if (trades.length === 0) return EMPTY_EXCURSIONS;

  let covered = 0;
  let heatSum = 0;
  let heatCount = 0;
  let throughStop = 0;
  let captureSum = 0;
  let captureCount = 0;
  let leftOnTable = 0;

  for (const trade of trades) {
    if (trade.mae === null && trade.mfe === null) continue;
    covered += 1;

    const winner = trade.profit > 0;
    if (!winner) continue;

    if (trade.mae !== null && trade.risk !== null && trade.risk > 0) {
      const heat = trade.mae / trade.risk;
      heatSum += heat;
      heatCount += 1;
      // Past its own stop distance and back — the trade only survived because the stop was
      // not where the risk figure says it was, or because it was moved.
      if (heat >= 1) throughStop += 1;
    }

    if (trade.mfe !== null && trade.mfe > 0) {
      // Clamped at 1: an exit better than the best price the bars showed is a rounding
      // artefact of bar granularity, not a trade that beat the market.
      captureSum += Math.min(1, trade.profit / trade.mfe);
      captureCount += 1;
      leftOnTable += Math.max(0, trade.mfe - trade.profit);
    }
  }

  return {
    covered,
    total: trades.length,
    coveragePercent: (covered / trades.length) * 100,
    winnerHeat: heatCount > 0 ? heatSum / heatCount : null,
    winnersThroughStop: throughStop,
    capture: captureCount > 0 ? (captureSum / captureCount) * 100 : null,
    leftOnTable,
  };
}
