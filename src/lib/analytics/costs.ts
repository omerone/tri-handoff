import type { AnalyticsTrade } from './types';

/**
 * What the book paid to exist.
 *
 * Commission and swap are on every trade the sync has ever written, and until now they were
 * visible on one screen — the single-trade page — one trade at a time. There was no answer
 * anywhere to "how much have I paid in commission", "what share of my gross profit did that
 * eat", or "which instrument is the expensive one". For an active trader those are not
 * bookkeeping questions: a strategy that grosses 12% a year and pays 9% of it away is a
 * different strategy from one that pays 1%, and the win rate, the profit factor and the R
 * multiples all look identical either way.
 *
 * **The sign convention.** MT5 reports both as signed amounts where negative is money
 * leaving: commission is essentially always negative, swap is usually negative and positive
 * when the carry is in your favour. `sync.ts` adds them to the gross profit to get the
 * `profit` column, so the stored figure is already net. Everything below turns them back into
 * *costs* — positive means paid — because "you paid 1,400 in commission" is the sentence a
 * trader is trying to read, and a table of negative numbers labelled "cost" is one someone
 * has to translate every time.
 */

export type Costs = {
  /** Commission paid. Positive is money out; a rebate would come through negative. */
  commission: number;
  /** Swap paid. Positive is money out, negative means the carry was earned. */
  swap: number;
  total: number;
  /** After costs — the same number every other screen calls `net`. */
  net: number;
  /** What the book would have made with no commission and no swap. */
  gross: number;
  /**
   * Costs over gross profit.
   *
   * Null when the book did not gross a profit: a share of nothing is not zero, and a
   * percentage against a negative denominator is a number that means the opposite of what it
   * looks like. The UI shows the absolute cost in that case, which is the honest figure.
   */
  shareOfGross: number | null;
  perTrade: number;
  /**
   * Trades that made money before costs and lost it after.
   *
   * The single most useful figure here, because it is the one that changes behaviour. A
   * scalper with forty of these is not a losing trader — they are a trader whose edge is
   * thinner than their commission, which is a different problem with a different fix.
   */
  turnedLosing: number;
};

export const EMPTY_COSTS: Costs = {
  commission: 0,
  swap: 0,
  total: 0,
  net: 0,
  gross: 0,
  shareOfGross: null,
  perTrade: 0,
  turnedLosing: 0,
};

/** Gross result of one trade: what it would have been with no costs. */
export function grossOf(trade: Pick<AnalyticsTrade, 'profit' | 'commission' | 'swap'>): number {
  return trade.profit - trade.commission - trade.swap;
}

/**
 * Costs of one trade, as a positive number when money was paid.
 *
 * The `+ 0` is not decoration. Negating zero in JavaScript gives `-0`, which compares equal to
 * `0` and formats as "-0" — so a commission-free trade would render its cost as "-₪0.00" on
 * screen. Adding zero normalises it.
 */
export function costOf(trade: Pick<AnalyticsTrade, 'commission' | 'swap'>): number {
  return -(trade.commission + trade.swap) + 0;
}

export function computeCosts(trades: readonly AnalyticsTrade[]): Costs {
  if (trades.length === 0) return EMPTY_COSTS;

  let commission = 0;
  let swap = 0;
  let net = 0;
  let turnedLosing = 0;

  for (const trade of trades) {
    commission -= trade.commission;
    swap -= trade.swap;
    net += trade.profit;
    // Strictly: break-even after costs counts as turned, because it was a winner before them.
    if (grossOf(trade) > 0 && trade.profit <= 0) turnedLosing += 1;
  }

  const total = commission + swap;
  const gross = net + total;

  return {
    // `+ 0` for the same reason as in `costOf`: a book with no commission at all sums to -0.
    commission: commission + 0,
    swap: swap + 0,
    total: total + 0,
    net,
    gross,
    shareOfGross: gross > 0 ? (total / gross) * 100 : null,
    perTrade: total / trades.length + 0,
    turnedLosing,
  };
}

export type CostBucket<K extends string = string> = {
  key: K;
  costs: Costs;
};

/**
 * Costs grouped by a key the caller chooses.
 *
 * Ordered by what was spent, descending, because the question this answers is "where is it
 * going" and the answer is almost always the top two rows. Keys that cost nothing are kept —
 * an instrument traded commission-free is information, not an absence.
 */
export function costsBy<K extends string>(
  trades: readonly AnalyticsTrade[],
  keyOf: (trade: AnalyticsTrade) => K,
): CostBucket<K>[] {
  const groups = new Map<K, AnalyticsTrade[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const bucket = groups.get(key);
    if (bucket) bucket.push(trade);
    else groups.set(key, [trade]);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({ key, costs: computeCosts(group) }))
    .sort((a, b) => b.costs.total - a.costs.total);
}

export function costsBySymbol(trades: readonly AnalyticsTrade[]): CostBucket[] {
  return costsBy(trades, (trade) => trade.symbol);
}

export function costsByStyle(trades: readonly AnalyticsTrade[]): CostBucket[] {
  return costsBy(trades, (trade) => trade.style);
}
