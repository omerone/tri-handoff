import {
  ORIGINAL_TP_ANSWERS,
  originalTpAnswer,
  TP_TIMINGS,
  type OriginalTpAnswer,
  type TpTiming,
} from './types';

/**
 * How the two exit questions were answered across a book.
 *
 * Counts rather than money on purpose. These are questions about discipline — did the exit
 * follow the plan — and weighting them by P&L would let one large winner drown out ten
 * trades closed early, which is the pattern the trader is trying to see.
 */

export type Answerable = {
  tpTiming: TpTiming | null;
  tookOriginalTp: boolean | null;
};

export type ReviewSlice<K extends string> = {
  key: K;
  count: number;
  /** Share of the population this slice's chart is drawn over, 0–1. */
  share: number;
};

export type ReviewBreakdown<K extends string> = {
  slices: ReviewSlice<K>[];
  /** Trades the chart is drawn over. */
  total: number;
  /** Trades in the book that have no answer yet. */
  unanswered: number;
};

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/**
 * Timing, over the trades that have been reviewed.
 *
 * Unanswered trades are excluded from the population rather than shown as a fourth slice.
 * Timing has no neutral answer to fall back on — "not yet reviewed" is a statement about the
 * trader's paperwork, not about the exit — so mixing it in would make the three real answers
 * shrink as the book grows rather than as the habit changes. The count is reported separately
 * so the page can say how much of the book the chart speaks for.
 */
export function tpTimingBreakdown(trades: readonly Answerable[]): ReviewBreakdown<TpTiming> {
  const answered = trades.filter((trade) => trade.tpTiming !== null);
  const slices = TP_TIMINGS.map((key) => {
    const count = answered.filter((trade) => trade.tpTiming === key).length;
    return { key, count, share: share(count, answered.length) };
  });

  return {
    slices,
    total: answered.length,
    unanswered: trades.length - answered.length,
  };
}

/**
 * Whether the original take-profit was the one that closed the trade.
 *
 * Unanswered *is* a slice here, unlike timing. This question has a natural third state — a
 * trade nobody has been back to — and hiding it would report a cleaner discipline than the
 * book shows: a trader who reviewed their three best trades and nothing else would read as
 * 100% on plan.
 */
export function originalTpBreakdown(
  trades: readonly Answerable[],
): ReviewBreakdown<OriginalTpAnswer> {
  const slices = ORIGINAL_TP_ANSWERS.map((key) => {
    const count = trades.filter((trade) => originalTpAnswer(trade.tookOriginalTp) === key).length;
    return { key, count, share: share(count, trades.length) };
  });

  return {
    slices,
    total: trades.length,
    unanswered: trades.filter((trade) => trade.tookOriginalTp === null).length,
  };
}
