import type { AssetClass, Direction, TradeStyle } from '@/lib/mt5/types';
import type { Session } from '@/lib/time/zone';

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
