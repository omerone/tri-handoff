import 'server-only';
import type { Prisma } from '@prisma/client';
import type { AssetClass, Direction, TradeStyle } from '@/lib/mt5/types';
import { stableHash } from '@/lib/import/delimited';
import type { TenantContext } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * Trades the trader typed in themselves.
 *
 * The product could only ever learn about a day or swing trade from the broker, which made
 * the whole journal useless to anyone not yet connected to MetaApi — and on this deployment
 * that is everyone. These are rows in the same `trades` table as the synced ones, so they
 * flow into the analytics, the calendar, the R-strip and the costs card without a single one
 * of those knowing the difference. One book, not two.
 *
 * **The ticket namespace is what keeps the two apart.** `trades` is keyed on
 * `(user_id, ticket)` and the sync upserts by that key. MT5 position ids are numeric, so
 * prefixing a manual trade's ticket with `manual:` puts it somewhere the broker can never
 * reach: a sync cannot overwrite one by coincidence, and this module cannot edit or delete a
 * synced trade even if it is handed its id. Both directions are enforced in the `where`
 * clauses rather than in a comment, because the failure mode of getting it wrong is a trader
 * losing either their own notes or their broker's history.
 */

export const MANUAL_TICKET_PREFIX = 'manual:';

export function isManualTicket(ticket: string): boolean {
  return ticket.startsWith(MANUAL_TICKET_PREFIX);
}

/**
 * The Prisma predicate for "this row was typed, not synced", and its inverse.
 *
 * Exported so the one other place that needs the distinction — `deleteAllTrades`, which wipes
 * the book when a different broker account is connected — uses the same definition rather
 * than its own copy of the string.
 */
export const MANUAL_ONLY: Prisma.TradeWhereInput = {
  ticket: { startsWith: MANUAL_TICKET_PREFIX },
};
export const SYNCED_ONLY: Prisma.TradeWhereInput = {
  NOT: { ticket: { startsWith: MANUAL_TICKET_PREFIX } },
};

export type ManualTradeInput = {
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  /** Chosen by the trader on the tab, not derived from the dates. See the note in `create`. */
  style: TradeStyle;
  openAt: Date;
  closeAt: Date;
  /** Net of costs, like every other `profit` in this table. */
  profit: number;
  /** In the account currency, so it sits beside a synced trade's risk. Null when not given. */
  risk: number | null;
  rr: number | null;
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
};

/**
 * The ticket a manual trade gets, derived from the trade itself.
 *
 * This used to be `manual:` plus a fresh `randomUUID()`, which meant the row was unique by
 * construction and therefore never a duplicate of anything — including of itself. Submitting
 * the form twice, a double-click, a retried request on a flaky connection, or the browser
 * replaying a POST all wrote a second identical trade, and two copies of one trade are not a
 * visible error: they are a P&L that is out by exactly one trade, a win rate pulled toward
 * that outcome, and a costs card that agrees with neither.
 *
 * Deriving the ticket from the trade's own identifying facts makes `(user_id, ticket)` do the
 * work it already does for the sync: the same trade submitted twice lands on the same key and
 * the second write updates the first. It is the same idea as the FTMO importer's ticket, and
 * deliberately the same helper, so the two cannot drift.
 *
 * **What it cannot tell apart.** Two genuinely separate trades identical in symbol, side,
 * volume, both prices *and* both timestamps to the second would collapse into one. On a real
 * book that does not happen — two fills that close in the same second at the same price are
 * one trade by any reading — but it is the honest limit of this approach, and it is the
 * reason the timestamps are in the fingerprint rather than just the prices.
 */
function manualTicket(input: ManualTradeInput): string {
  return (
    MANUAL_TICKET_PREFIX +
    stableHash([
      input.symbol,
      input.direction,
      String(input.volume),
      input.openAt.toISOString(),
      input.closeAt.toISOString(),
      String(input.entryPrice),
      String(input.exitPrice ?? ''),
      String(input.profit),
    ])
  );
}

/**
 * Writes one, with a ticket the sync can never produce.
 *
 * `style` is stored as the trader chose it rather than derived from the dates the way the
 * sync derives it. On the sync the dates are the only evidence there is; here the person who
 * took the trade is telling us, and a swing they opened and closed inside one session is
 * still a swing to them. Their answer wins.
 *
 * Idempotent on the trade's own content — see `manualTicket`. The journal columns are left
 * out of the update for the same reason `upsertTrades` leaves them out: re-submitting a trade
 * must not erase the note someone wrote against it.
 */
export async function createManualTrade(
  ctx: TenantContext,
  input: ManualTradeInput,
): Promise<string> {
  assertContext(ctx);

  const ticket = manualTicket(input);
  const fields = {
    kind: 'trade',
    symbol: input.symbol,
    assetClass: input.assetClass,
    direction: input.direction,
    style: input.style,
    openAt: input.openAt,
    closeAt: input.closeAt,
    volume: input.volume,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    sl: input.stopLoss,
    tp: input.takeProfit,
    commission: input.commission,
    swap: input.swap,
    profit: input.profit,
    risk: input.risk,
    rr: input.rr,
  } as const;

  const row = await prisma.trade.upsert({
    where: { userId_ticket: { userId: ctx.userId, ticket } },
    create: { userId: ctx.userId, ticket, ...fields },
    update: fields,
    select: { id: true },
  });

  return row.id;
}

/**
 * Deletes one, and only if it was typed rather than synced.
 *
 * The ticket predicate is in the `where`, not checked beforehand: a read-then-delete would be
 * two statements with a gap between them, and the gap is where a synced trade gets removed by
 * an id that pointed at a manual one when it was read. Returns false when nothing matched,
 * which covers "not yours", "not manual" and "already gone" alike — none of which the caller
 * should be able to tell apart.
 */
export async function deleteManualTrade(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.trade.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, ...MANUAL_ONLY },
  });
  return count > 0;
}

/** Whether a trade id names a manual row belonging to this trader. */
export async function isManualTrade(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const found = await prisma.trade.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, ...MANUAL_ONLY },
    select: { id: true },
  });
  return found !== null;
}

export type ManualTradeRow = {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date | null;
  profit: number;
  risk: number | null;
  rr: number | null;
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  /** Whether anything has been written in the journal against it. */
  journalled: boolean;
};

const num = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

/** The manual rows of one style, newest close first — what the tab lists. */
export async function listManualTrades(
  ctx: TenantContext,
  style: TradeStyle,
): Promise<ManualTradeRow[]> {
  assertContext(ctx);

  const rows = await prisma.trade.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      kind: 'trade',
      style,
      ...MANUAL_ONLY,
    },
    orderBy: [{ closeAt: 'desc' }, { createdAt: 'desc' }],
    take: 2000,
  });

  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    assetClass: row.assetClass,
    direction: row.direction,
    style: row.style,
    openAt: row.openAt,
    closeAt: row.closeAt,
    profit: Number(row.profit),
    risk: num(row.risk),
    rr: num(row.rr),
    volume: Number(row.volume),
    entryPrice: Number(row.entryPrice),
    exitPrice: num(row.exitPrice),
    stopLoss: num(row.sl),
    takeProfit: num(row.tp),
    commission: Number(row.commission),
    swap: Number(row.swap),
    journalled: Boolean(
      row.note || row.tags.length > 0 || row.rating || row.mood || row.strategy,
    ),
  }));
}

/**
 * How many trades a broker swap would actually destroy.
 *
 * The confirmation before replacing an account names a number, and that number is what the
 * person is agreeing to lose. `countTrades` counts the whole book, which now includes rows
 * `deleteAllTrades` deliberately spares — so using it here would warn about losing trades
 * that survive, and a warning that overstates is one people learn to click through.
 */
export async function countSyncedTrades(ctx: TenantContext): Promise<number> {
  assertContext(ctx);
  return prisma.trade.count({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      kind: 'trade',
      closeAt: { not: null },
      ...SYNCED_ONLY,
    },
  });
}

/** How many manual trades exist, per style — for the tab counts. */
export async function countManualTrades(
  ctx: TenantContext,
): Promise<Record<TradeStyle, number>> {
  assertContext(ctx);
  const grouped = await prisma.trade.groupBy({
    by: ['style'],
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, kind: 'trade', ...MANUAL_ONLY },
    _count: { _all: true },
  });

  const counts: Record<TradeStyle, number> = { day: 0, swing: 0 };
  for (const group of grouped) counts[group.style] = group._count._all;
  return counts;
}
