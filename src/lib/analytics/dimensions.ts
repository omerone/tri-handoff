import { sessionOfHour, wallClock, zonedDateKey, type Session } from '@/lib/time/zone';
import { toIsoDate } from '@/lib/time/format';
import type { AssetClass, Direction, TradeStyle } from '@/lib/mt5/types';
import { computeMetrics } from './metrics';
import type { AnalyticsTrade, Bucket, HeatCell, Metrics } from './types';

/**
 * "Where am I most profitable" — SPEC §3.5.
 *
 * Every dimension here is a *partition*: each trade lands in exactly one bucket, and the
 * buckets cover every trade. That is not decoration, it is the property that makes the
 * numbers trustworthy — if a dimension's buckets did not sum to the total, one of the bars
 * on the analytics page would be silently wrong, and there is no way to notice that by
 * looking. The invariant is asserted for all six dimensions in the tests.
 *
 * The wall-clock dimensions (weekday, hour, session) are read in the analytics timezone from
 * the **open** time: "which day do I trade well on" is a question about when the position was
 * entered. The calendar and the equity curve group by **close**, because that is when the
 * money moved. The prototype made the same split.
 */

function bucketBy<K extends string>(
  trades: readonly AnalyticsTrade[],
  keys: readonly K[],
  keyOf: (trade: AnalyticsTrade) => K,
): Bucket<K>[] {
  const groups = new Map<K, AnalyticsTrade[]>();
  for (const key of keys) groups.set(key, []);

  for (const trade of trades) {
    const key = keyOf(trade);
    const group = groups.get(key);
    if (group) group.push(trade);
    // A trade whose key is outside the declared set would break the partition, so `keys`
    // always covers the full enum rather than being derived from the data.
  }

  return keys.map((key) => ({ key, metrics: computeMetrics(groups.get(key) ?? []) }));
}

/** Monday–Friday, the days markets are open and the prototype charted. */
export const WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const SESSIONS: readonly Session[] = ['asia', 'london', 'ny'];
export const DIRECTIONS: readonly Direction[] = ['long', 'short'];
export const STYLES: readonly TradeStyle[] = ['day', 'swing'];
export const ASSET_CLASSES: readonly AssetClass[] = [
  'forex',
  'crypto',
  'indices',
  'stocks',
  'commodities',
  'other',
];

export function byWeekday(trades: readonly AnalyticsTrade[]): Bucket<string>[] {
  return bucketBy(
    trades,
    WEEKDAYS.map(String),
    (trade) => String(wallClock(trade.openAt).weekday),
  );
}

/** Every hour of the day that has at least one trade, in clock order. */
export function byHour(trades: readonly AnalyticsTrade[]): Bucket<string>[] {
  const hours = [...new Set(trades.map((t) => wallClock(t.openAt).hour))].sort((a, b) => a - b);
  return bucketBy(trades, hours.map(String), (trade) => String(wallClock(trade.openAt).hour));
}

export function bySession(trades: readonly AnalyticsTrade[]): Bucket<Session>[] {
  return bucketBy(trades, SESSIONS, (trade) => sessionOfHour(wallClock(trade.openAt).hour));
}

export function byDirection(trades: readonly AnalyticsTrade[]): Bucket<Direction>[] {
  return bucketBy(trades, DIRECTIONS, (trade) => trade.direction);
}

export function byStyle(trades: readonly AnalyticsTrade[]): Bucket<TradeStyle>[] {
  return bucketBy(trades, STYLES, (trade) => trade.style);
}

export function byAssetClass(trades: readonly AnalyticsTrade[]): Bucket<AssetClass>[] {
  return bucketBy(trades, ASSET_CLASSES, (trade) => trade.assetClass);
}

/**
 * By strategy — the dimension SPEC §3.5 left open with a 🔶.
 *
 * `UNLABELLED` is a real bucket rather than an exclusion. A trader who has journalled forty
 * trades and not the other three hundred needs to see that the comparison rests on forty; if
 * unlabelled trades simply vanished, the strategy breakdown would sum to less than the book
 * and there would be nothing on screen to say so. It also keeps the partition invariant
 * intact, which is what the tests check.
 */
export const UNLABELLED = '__unlabelled__';

export function byStrategy(trades: readonly AnalyticsTrade[]): Bucket<string>[] {
  const named = [...new Set(trades.map((t) => t.strategy).filter((s): s is string => !!s))].sort();
  const keys = trades.some((t) => !t.strategy) ? [...named, UNLABELLED] : named;
  return bucketBy(trades, keys, (trade) => trade.strategy || UNLABELLED);
}

export function bySymbol(trades: readonly AnalyticsTrade[]): Bucket<string>[] {
  const symbols = [...new Set(trades.map((t) => t.symbol))].sort();
  return bucketBy(trades, symbols, (trade) => trade.symbol);
}

/**
 * Day × session grid.
 *
 * Every cell exists even when empty, so the grid always renders 5×3 and a gap is visibly a
 * gap rather than a missing square.
 */
export function heatmap(trades: readonly AnalyticsTrade[]): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  for (const weekday of WEEKDAYS) {
    for (const session of SESSIONS) {
      cells.set(`${weekday}:${session}`, { weekday, session, net: 0, count: 0 });
    }
  }

  for (const trade of trades) {
    const clock = wallClock(trade.openAt);
    const cell = cells.get(`${clock.weekday}:${sessionOfHour(clock.hour)}`);
    if (!cell) continue; // Weekend trade — no square for it on a Mon–Fri grid.
    cell.net += trade.profit;
    cell.count += 1;
  }

  return [...cells.values()];
}

export type DailyTotal = {
  /** `YYYY-MM-DD` in the analytics timezone. */
  date: string;
  net: number;
  count: number;
  wins: number;
};

/**
 * Daily totals for the calendar, keyed by the **close** date.
 *
 * Close, not open: the calendar answers "what did this day earn me", and a swing trade
 * entered in March that closed in April earned it in April. Combined with the day/swing rule
 * in the sync — which is also calendar-based — a day trade always lands on exactly one
 * square.
 */
export function dailyTotals(trades: readonly AnalyticsTrade[]): Map<string, DailyTotal> {
  const days = new Map<string, DailyTotal>();

  for (const trade of trades) {
    const date = zonedDateKey(trade.closeAt);
    const day = days.get(date) ?? { date, net: 0, count: 0, wins: 0 };
    day.net += trade.profit;
    day.count += 1;
    if (trade.profit > 0) day.wins += 1;
    days.set(date, day);
  }

  return days;
}

/**
 * The last N calendar days, one entry each, most recent last.
 *
 * The R-strip used to be one bar per trade. A trader reading it could not tell whether six
 * bars were six days or one busy afternoon, and the window slid with activity rather than
 * with the calendar — "the last sixty trades" is a different span every time you look. Days
 * are a span a person can hold: this week against last week.
 *
 * Quiet days are *included*, with zero trades. That is the point of a strip rather than a
 * list: the gaps are information. A week off looks like a week off.
 *
 * `netR` sums only the trades that had a stop loss, because a trade without one has no R —
 * the same rule the rest of the product follows. `rrTrades` reports how many contributed, so
 * a day whose R is computed from half its trades can say so instead of looking complete.
 *
 * The window ends on the most recent trade's day, not on today: a demo account, or a trader
 * back from a break, would otherwise open on thirty empty columns.
 */
export type DailyR = {
  /** `YYYY-MM-DD` in the analytics timezone. */
  date: string;
  /** Sum of R over the day's trades that had a stop loss. */
  netR: number;
  /** How many of the day's trades contributed an R. */
  rrTrades: number;
  count: number;
  wins: number;
  net: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function recentDailyR(trades: readonly AnalyticsTrade[], days = 30): DailyR[] {
  if (trades.length === 0 || days <= 0) return [];

  const byDate = new Map<string, DailyR>();
  let newest = '';
  for (const trade of trades) {
    const date = zonedDateKey(trade.closeAt);
    if (date > newest) newest = date;
    const day = byDate.get(date) ?? { date, netR: 0, rrTrades: 0, count: 0, wins: 0, net: 0 };
    day.count += 1;
    day.net += trade.profit;
    if (trade.profit > 0) day.wins += 1;
    if (trade.rr !== null) {
      day.netR += trade.rr;
      day.rrTrades += 1;
    }
    byDate.set(date, day);
  }

  // A `YYYY-MM-DD` key is a calendar date, so stepping it as UTC midnight is exact — no
  // daylight-saving arithmetic, and no dependency on where the server happens to be.
  const end = Date.parse(`${newest}T00:00:00Z`);
  const window: DailyR[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const stepped = new Date(end - offset * DAY_MS);
    const date = toIsoDate({
      year: stepped.getUTCFullYear(),
      month: stepped.getUTCMonth() + 1,
      day: stepped.getUTCDate(),
    });
    window.push(byDate.get(date) ?? { date, netR: 0, rrTrades: 0, count: 0, wins: 0, net: 0 });
  }
  return window;
}

export type Insight = {
  /** Translation-ready descriptor rather than a formatted string. */
  dimension: 'weekday' | 'session' | 'assetClass' | 'direction' | 'style' | 'strategy';
  key: string;
  metrics: Metrics;
};

/**
 * The prototype's "where you are most profitable" ranking.
 *
 * Ranked by average R rather than by net profit, because net rewards whoever traded the most
 * — the question is which conditions pay best, not which the trader used most often. Buckets
 * below `minTrades` are dropped: an average R computed from two trades is noise, and putting
 * it at the top of the list would be actively misleading.
 */
export function bestConditions(
  trades: readonly AnalyticsTrade[],
  options: { minTrades?: number; limit?: number } = {},
): Insight[] {
  const minTrades = options.minTrades ?? 5;
  const limit = options.limit ?? 5;

  const candidates: Insight[] = [
    ...byWeekday(trades).map((b) => ({ dimension: 'weekday' as const, key: b.key, metrics: b.metrics })),
    ...bySession(trades).map((b) => ({ dimension: 'session' as const, key: b.key, metrics: b.metrics })),
    ...byAssetClass(trades).map((b) => ({ dimension: 'assetClass' as const, key: b.key, metrics: b.metrics })),
    ...byDirection(trades).map((b) => ({ dimension: 'direction' as const, key: b.key, metrics: b.metrics })),
    ...byStyle(trades).map((b) => ({ dimension: 'style' as const, key: b.key, metrics: b.metrics })),
    // Only *named* strategies compete here. "Unlabelled" winning the ranking would tell the
    // trader nothing they could act on.
    ...byStrategy(trades)
      .filter((b) => b.key !== UNLABELLED)
      .map((b) => ({ dimension: 'strategy' as const, key: b.key, metrics: b.metrics })),
  ];

  return candidates
    .filter((c) => c.metrics.count >= minTrades && c.metrics.avgRr !== null)
    .sort((a, b) => (b.metrics.avgRr ?? 0) - (a.metrics.avgRr ?? 0))
    .slice(0, limit);
}
