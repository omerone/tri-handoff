import type { AnalyticsTrade } from './types';

/**
 * Two things the P&L total cannot say.
 *
 * Both are about *sequence and duration* rather than about sums, which is why they are not
 * fields on `Metrics`: that type is a single pass over an unordered bag of trades, and these
 * only mean anything in close order.
 */

export type Streaks = {
  /** Longest run of consecutive wins in the window. */
  longestWin: number;
  /** Longest run of consecutive losses. */
  longestLoss: number;
  /**
   * The run the book ends on: positive for wins, negative for losses, zero for an empty
   * window. Signed rather than a pair, because "where am I right now" is one fact.
   */
  current: number;
};

/**
 * Consecutive wins and losses.
 *
 * The statistic traders ask for first, and the one a profit factor hides completely: eight
 * winners and four losers is the same ratio whether the losers were spread out or arrived in
 * a row on one afternoon. Only the second is the one that empties an account, and only the
 * second is the one that makes someone double their size to win it back.
 *
 * Break-even trades — exactly zero after costs — end both runs without starting either. They
 * are neither a win nor a loss, and counting them as a loss would report a discipline failure
 * that did not happen.
 */
export function streaks(trades: readonly AnalyticsTrade[]): Streaks {
  let longestWin = 0;
  let longestLoss = 0;
  let run = 0;

  for (const trade of trades) {
    if (trade.profit > 0) {
      run = run > 0 ? run + 1 : 1;
      longestWin = Math.max(longestWin, run);
    } else if (trade.profit < 0) {
      run = run < 0 ? run - 1 : -1;
      longestLoss = Math.max(longestLoss, -run);
    } else {
      run = 0;
    }
  }

  return { longestWin, longestLoss, current: run };
}

export type HoldTimes = {
  /** Mean minutes held, winners only. Null when the window has none. */
  winners: number | null;
  /** Mean minutes held, losers only. Null when the window has none. */
  losers: number | null;
  /**
   * `winners / losers`. Below 1 means losers are held longer than winners — cutting winners
   * short and letting losers run, in one number. Null when either side is missing, because a
   * ratio against nothing is not a finding.
   */
  ratio: number | null;
};

/**
 * How long winners are held against how long losers are held.
 *
 * The classic asymmetry, and invisible in every other figure on the dashboard. A trader who
 * closes winners in twenty minutes and sits with losers for two days can still show a decent
 * win rate and a positive month; the habit only appears when the two durations are put side
 * by side.
 *
 * Break-even trades are excluded from both sides rather than assigned to one. They would
 * otherwise pull whichever mean they landed in toward a number that describes neither habit.
 */
export function holdTimes(trades: readonly AnalyticsTrade[]): HoldTimes {
  let winMinutes = 0;
  let winCount = 0;
  let lossMinutes = 0;
  let lossCount = 0;

  for (const trade of trades) {
    const minutes = (trade.closeAt.getTime() - trade.openAt.getTime()) / 60_000;
    // A close stamped before its open is broker data nobody can act on; it would drag a mean
    // downward silently, so it is skipped rather than clamped to zero.
    if (!Number.isFinite(minutes) || minutes < 0) continue;

    if (trade.profit > 0) {
      winMinutes += minutes;
      winCount += 1;
    } else if (trade.profit < 0) {
      lossMinutes += minutes;
      lossCount += 1;
    }
  }

  const winners = winCount > 0 ? winMinutes / winCount : null;
  const losers = lossCount > 0 ? lossMinutes / lossCount : null;

  return {
    winners,
    losers,
    ratio: winners !== null && losers !== null && losers > 0 ? winners / losers : null,
  };
}
