import type { AssetClass, Direction, TradeStyle } from '@/lib/mt5/types';
import type { Session } from '@/lib/time/zone';
import type { TpTiming } from '@/lib/review/types';

/**
 * The analytics engine's own view of a trade.
 *
 * Deliberately narrower than the database record: the engine is pure arithmetic over closed
 * trades and must stay testable without a database, a tenant or a request. Anything it does
 * not need — ticket, prices, journal notes — is left out so that it cannot come to depend on
 * them.
 */
export type AnalyticsTrade = {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date;
  /** Net of commission and swap. */
  profit: number;
  risk: number | null;
  /** Null when the trade had no stop loss — excluded from RR aggregates, see risk.ts. */
  rr: number | null;
  /**
   * The trader's own label for how they took the trade (SPEC §3.5 asks for this dimension).
   * Null until they write one — an unlabelled trade is its own bucket, not a missing row.
   */
  strategy: string | null;
  /**
   * How the trader scored their own execution, 1–5, and how they felt taking it.
   *
   * Both were collected from the first release and never left the journal form — the icon in
   * the trades table only knew whether *something* had been written. They are here so the two
   * can be crossed with the outcome, which is the question they were being collected for:
   * whether the trades someone rated badly are the ones that lose.
   */
  rating: number | null;
  mood: string | null;
  /**
   * The two exit-review answers. They are on the trade rather than in a side table because
   * every screen that charts them already has the book loaded, and because a review is a
   * property of the trade it is about.
   */
  tpTiming: TpTiming | null;
  tookOriginalTp: boolean | null;
};

export type Metrics = {
  count: number;
  /** Sum of net profit. */
  net: number;
  wins: number;
  losses: number;
  winRate: number;
  grossWin: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  /** Mean net profit per trade — what a trader expects to make on the next one. */
  expectancy: number;
  /** Mean R multiple over the trades that have one. Null when none do. */
  avgRr: number | null;
  /** How many trades carried a stop loss, and what share of the total that is. */
  rrCoverage: { withRr: number; total: number; percent: number };
};

export type EquityPoint = {
  /** 1-based index of the trade in close order — the x-axis of the curve. */
  index: number;
  closeAt: Date;
  balance: number;
};

export type Drawdown = {
  /** Largest peak-to-trough fall in account currency, as a positive number. */
  maxDrawdown: number;
  maxDrawdownPercent: number;
  peakAt: Date | null;
  troughAt: Date | null;
};

/**
 * The mirror of a drawdown: the largest trough-to-peak *rise* the account made.
 *
 * Not the same as the biggest winning trade, and not the same as total profit. It is the
 * best run the account put together — which is the figure that belongs beside the worst one,
 * because both answer "how far did this move in one stretch".
 */
export type RunUp = {
  /** Largest trough-to-peak rise in account currency, as a positive number. */
  maxRunUp: number;
  maxRunUpPercent: number;
  troughAt: Date | null;
  peakAt: Date | null;
};

export type Bucket<K extends string = string> = {
  key: K;
  metrics: Metrics;
};

export type DimensionKey = 'weekday' | 'hour' | 'session' | 'direction' | 'assetClass' | 'style';

export type HeatCell = {
  weekday: number;
  session: Session;
  net: number;
  count: number;
};
