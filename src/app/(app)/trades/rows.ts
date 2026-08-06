import 'server-only';
import type { AssetClass, Direction } from '@/lib/mt5/types';
import type { TpTiming } from '@/lib/review/types';
import type { StoredLongPosition } from '@/lib/db';
import type { TradeRecord } from '@/lib/db/trades';
import { getFxRate, hasRate } from '@/lib/money/fx';
import { classifySymbol } from '@/lib/mt5/symbols';

/**
 * One row of the trades table, from either of the two things a user can close.
 *
 * A closed long-term holding is not a deal — it has no stop loss, so no risk and no R — but
 * it is money realised on a date, which is what this table is a record of. Keeping both in
 * one shape lets the table, the pager and the summary bar agree on a single population, the
 * property the page was already built around.
 */

/** `long` is a row style, not a `TradeStyle`: the database enum has only `day` and `swing`. */
export type RowStyle = 'day' | 'swing' | 'long';

export type TableRow = {
  key: string;
  /** Journal page for a deal; the holdings tab for a position, which has no journal. */
  href: string;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: RowStyle;
  risk: number | null;
  rr: number | null;
  /**
   * In the account's currency, so the page's single `money()` renders every row the same way.
   * `null` when a position's own currency could not be converted — see `toRows`.
   */
  profit: number | null;
  /** Set only when `profit` is null: the amount in the currency it is actually held in. */
  profitInOwnCurrency: { amount: number; currency: string } | null;
  closeAt: Date | null;
  /** Drives the summary split: positions count toward money, never toward R. */
  isPosition: boolean;
  /** Whether anything has been written about this row; always false for a holding. */
  journalled: boolean;
  strategy: string | null;
  /**
   * Enough of the journal to scan a week without opening every trade.
   *
   * The table used to collapse note, tags, rating and mood into one boolean icon, which meant
   * a trader could write four thousand characters about a trade and then only ever find them
   * again by opening that trade and looking inside a textarea. The score reads at a glance and
   * the first line of the note is usually the whole point of it.
   */
  rating: number | null;
  mood: string | null;
  noteExcerpt: string | null;
  /**
   * The two exit questions. Null on a holding, which has no take-profit to have hit — the
   * row renders nothing rather than an unanswerable control.
   */
  tpTiming: TpTiming | null;
  tookOriginalTp: boolean | null;
};

export type RowFilter = {
  assetClass?: AssetClass;
  direction?: Direction;
  style?: RowStyle;
  /**
   * Only deals carry these, so narrowing by either excludes every holding — a position has
   * no strategy and no tags to match, and showing it anyway would answer a question it was
   * never asked.
   */
  strategy?: string;
  tag?: string;
  /**
   * The free-text box. The deals were already narrowed by it in SQL — see `textSearch` in
   * db/trades.ts — so this only has to decide the holdings, and a holding has none of the
   * fields that search looks in except its symbol. Matching it against the note or the
   * strategy of a *deal* is not something a holding can lose or win; it simply has neither.
   */
  query?: string;
};

function tradeRow(trade: TradeRecord): TableRow {
  return {
    key: `trade:${trade.id}`,
    href: `/trades/${trade.id}`,
    symbol: trade.symbol,
    assetClass: trade.assetClass,
    direction: trade.direction,
    style: trade.style,
    risk: trade.risk,
    rr: trade.rr,
    profit: trade.profit,
    profitInOwnCurrency: null,
    closeAt: trade.closeAt,
    isPosition: false,
    journalled: Boolean(
      trade.note || trade.tags.length > 0 || trade.rating || trade.mood || trade.strategy,
    ),
    strategy: trade.strategy,
    rating: trade.rating,
    mood: trade.mood,
    noteExcerpt: excerpt(trade.note),
    tpTiming: trade.tpTiming,
    tookOriginalTp: trade.tookOriginalTp,
  };
}

/**
 * Positions are priced in whatever currency they are held in, while every deal is in the
 * account currency — so a holding has to be converted before it can share a column with them.
 *
 * A missing rate does *not* fall through as 1:1. That is how a thousand francs becomes a
 * thousand dollars; the row keeps its own currency and drops out of the total instead, which
 * is visibly incomplete rather than quietly wrong.
 */
async function positionRows(
  positions: readonly StoredLongPosition[],
  accountCurrency: string,
): Promise<TableRow[]> {
  const currencies = [...new Set(positions.map((p) => p.currency.toUpperCase()))];
  const rates = new Map<string, number>();

  await Promise.all(
    currencies.map(async (currency) => {
      if (currency === accountCurrency.toUpperCase()) {
        rates.set(currency, 1);
        return;
      }
      const fx = await getFxRate(currency, accountCurrency);
      if (hasRate(fx)) rates.set(currency, fx.rate);
    }),
  );

  return positions.map((position) => {
    const currency = position.currency.toUpperCase();
    const rate = rates.get(currency);
    const realized = position.realizedPnl ?? 0;

    return {
      key: `position:${position.id}`,
      href: '/long',
      symbol: position.symbol,
      assetClass: classifySymbol(position.symbol),
      // A holding is bought to be sold; there is no short side of this table.
      direction: 'long' as Direction,
      style: 'long' as RowStyle,
      // Both are properties of a stop loss, which a holding does not have.
      risk: null,
      rr: null,
      profit: rate === undefined ? null : realized * rate,
      profitInOwnCurrency: rate === undefined ? { amount: realized, currency } : null,
      closeAt: position.closedAt,
      isPosition: true,
      journalled: false,
      strategy: null,
      rating: null,
      mood: null,
      noteExcerpt: null,
      tpTiming: null,
      tookOriginalTp: null,
    };
  });
}

function matches(row: TableRow, filter: RowFilter): boolean {
  if (filter.assetClass && row.assetClass !== filter.assetClass) return false;
  if (filter.direction && row.direction !== filter.direction) return false;
  if (filter.style && row.style !== filter.style) return false;
  if (filter.query && !row.symbol.toLowerCase().includes(filter.query.toLowerCase())) return false;
  return true;
}

/**
 * Deals and closed holdings, filtered together and ordered by the date they were realised.
 *
 * The trades are passed in already narrowed by the query; the positions are filtered here,
 * because the dropdowns describe row properties rather than columns of `long_positions` and
 * there are few enough holdings that it is not worth a second `where`.
 */
export async function toRows(
  trades: readonly TradeRecord[],
  positions: readonly StoredLongPosition[],
  options: { accountCurrency: string; filter: RowFilter },
): Promise<TableRow[]> {
  // A strategy filter is a question about deals, so no holding can answer it, and narrowing
  // to a deal style excludes them for the same reason. Narrowing to `long` is the mirror
  // image: it asks for holdings, so no deal qualifies.
  const includePositions =
    !options.filter.strategy &&
    !options.filter.tag &&
    options.filter.style !== 'day' &&
    options.filter.style !== 'swing';
  const includeTrades = options.filter.style !== 'long';

  const rows = includeTrades ? trades.map(tradeRow) : [];
  if (includePositions) {
    const built = await positionRows(positions, options.accountCurrency);
    rows.push(...built.filter((row) => matches(row, options.filter)));
  }

  return rows.sort((a, b) => (b.closeAt?.getTime() ?? 0) - (a.closeAt?.getTime() ?? 0));
}

/**
 * The summary bar.
 *
 * Money counts every row; R and its relatives count only deals. A holding closed at a profit
 * is real money and belongs in the total, but it has no stop loss to measure against, so
 * folding it into an average R would be dividing by a denominator it never contributed to.
 */
export function summarize(rows: readonly TableRow[]): {
  /** Deals only — the population the R and win-rate figures beside it are computed over. */
  trades: number;
  /** Closed holdings, counted separately rather than folded into the trade count. */
  positions: number;
  net: number;
  unconverted: number;
} {
  let net = 0;
  let unconverted = 0;
  let trades = 0;
  let positions = 0;
  for (const row of rows) {
    if (row.isPosition) positions += 1;
    else trades += 1;
    if (row.profit === null) unconverted += 1;
    else net += row.profit;
  }
  /*
   * Two counts, not one.
   *
   * This returned `rows.length` under the name `count`, and the page rendered it as
   * "98 trades" — 97 deals plus a closed holding. Three things were wrong with one number:
   * a holding is not a trade, the average RR printed beside it is computed over the deals
   * alone (see `isPosition` above, which says exactly that), and the dashboard's own trade
   * count therefore disagreed with this screen by one.
   *
   * The net still spans both, because "what did this window make me" is a question about
   * money and a holding's realised gain is money.
   */
  return { trades, positions, net, unconverted };
}

/**
 * The first line of a note, short enough for a tooltip.
 *
 * Newlines collapse to spaces: a tooltip renders them as nothing, so a note written as a list
 * would otherwise arrive as one run-on line with words fused together at the joins.
 */
const EXCERPT_LENGTH = 140;

function excerpt(note: string | null): string | null {
  if (!note) return null;
  const flat = note.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}
