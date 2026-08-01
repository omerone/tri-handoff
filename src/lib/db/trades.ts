import 'server-only';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import type { AssetClass, DealKind, Direction, TradeStyle } from '@/lib/mt5/types';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * Trades.
 *
 * Everything here is scoped by `ctx.userId` *and* joined back to `ctx.tenantId`, so a context
 * that somehow paired one tenant with another's user still selects nothing. The join costs a
 * little; one trader's book being visible on another's domain would cost rather more.
 *
 * Prisma returns `Decimal` for money columns. Conversion to `number` happens here, at the
 * boundary, so the analytics engine is plain arithmetic — see the note in schema.prisma.
 */

export type TradeRecord = {
  id: string;
  ticket: string;
  kind: DealKind;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date | null;
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  /** Net of commission and swap: the money that actually moved. */
  profit: number;
  risk: number | null;
  rr: number | null;
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
};

export type TradeUpsert = Omit<TradeRecord, 'id' | 'note' | 'tags' | 'rating' | 'mood' | 'strategy'>;

const num = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

type TradeRow = {
  id: string;
  ticket: string;
  kind: DealKind;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date | null;
  volume: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  exitPrice: Prisma.Decimal | null;
  sl: Prisma.Decimal | null;
  tp: Prisma.Decimal | null;
  commission: Prisma.Decimal;
  swap: Prisma.Decimal;
  profit: Prisma.Decimal;
  risk: Prisma.Decimal | null;
  rr: Prisma.Decimal | null;
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
};

function toRecord(row: TradeRow): TradeRecord {
  return {
    id: row.id,
    ticket: row.ticket,
    kind: row.kind,
    symbol: row.symbol,
    assetClass: row.assetClass,
    direction: row.direction,
    style: row.style,
    openAt: row.openAt,
    closeAt: row.closeAt,
    volume: Number(row.volume),
    entryPrice: Number(row.entryPrice),
    exitPrice: num(row.exitPrice),
    stopLoss: num(row.sl),
    takeProfit: num(row.tp),
    commission: Number(row.commission),
    swap: Number(row.swap),
    profit: Number(row.profit),
    risk: num(row.risk),
    rr: num(row.rr),
    note: row.note,
    tags: row.tags,
    rating: row.rating,
    mood: row.mood,
    strategy: row.strategy,
  };
}

/**
 * Idempotent import.
 *
 * Keyed on `(user_id, ticket)`, so re-running a sync — which happens on every login, and
 * again whenever the user hits refresh — updates rather than duplicates. That matters
 * beyond tidiness: a duplicated trade would inflate net P&L and drag win rate toward the
 * duplicated outcome, and nothing in the UI would look wrong.
 *
 * Returns how many rows were new, which is what the sync log reports back to the user.
 */
export async function upsertTrades(
  ctx: TenantContext,
  trades: TradeUpsert[],
): Promise<{ imported: number; updated: number }> {
  assertContext(ctx);
  if (trades.length === 0) return { imported: 0, updated: 0 };

  const tickets = trades.map((trade) => trade.ticket);
  const existing = await prisma.trade.findMany({
    where: { userId: ctx.userId, ticket: { in: tickets } },
    select: { ticket: true },
  });
  const known = new Set(existing.map((row) => row.ticket));

  const data = (trade: TradeUpsert) => ({
    kind: trade.kind,
    symbol: trade.symbol,
    assetClass: trade.assetClass,
    direction: trade.direction,
    style: trade.style,
    openAt: trade.openAt,
    closeAt: trade.closeAt,
    volume: trade.volume,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    sl: trade.stopLoss,
    tp: trade.takeProfit,
    commission: trade.commission,
    swap: trade.swap,
    profit: trade.profit,
    risk: trade.risk,
    rr: trade.rr,
  });

  // Chunked so a full backfill of a long-lived account doesn't build one enormous
  // transaction; the whole point of the ticket key is that a partial run is safe to repeat.
  const CHUNK = 200;
  for (let offset = 0; offset < trades.length; offset += CHUNK) {
    const chunk = trades.slice(offset, offset + CHUNK);
    await prisma.$transaction(
      chunk.map((trade) =>
        prisma.trade.upsert({
          where: { userId_ticket: { userId: ctx.userId, ticket: trade.ticket } },
          create: { userId: ctx.userId, ticket: trade.ticket, ...data(trade) },
          update: data(trade),
        }),
      ),
    );
  }

  const imported = trades.filter((trade) => !known.has(trade.ticket)).length;
  return { imported, updated: trades.length - imported };
}

export type TradeFilter = {
  assetClass?: AssetClass;
  direction?: Direction;
  style?: TradeStyle;
  symbol?: string;
  from?: Date;
  to?: Date;
};

function whereClause(
  ctx: TenantContext,
  filter: TradeFilter = {},
  options: { closedOnly?: boolean } = {},
): Prisma.TradeWhereInput {
  const closeAt: Prisma.DateTimeNullableFilter = {};
  if (filter.from) closeAt.gte = filter.from;
  if (filter.to) closeAt.lte = filter.to;
  if (options.closedOnly) closeAt.not = null;

  return {
    userId: ctx.userId,
    // Belt and braces: a context is only ever minted from a verified tenant/user pair, but
    // the join means even a forged one selects nothing.
    user: { tenantId: ctx.tenantId },
    // Analytics is about trading performance; deposits and withdrawals are not trades.
    kind: 'trade',
    ...(filter.assetClass ? { assetClass: filter.assetClass } : {}),
    ...(filter.direction ? { direction: filter.direction } : {}),
    ...(filter.style ? { style: filter.style } : {}),
    ...(filter.symbol ? { symbol: filter.symbol } : {}),
    ...(Object.keys(closeAt).length > 0 ? { closeAt } : {}),
  };
}

/** Every closed trade, oldest first — what the analytics engine runs over. */
export async function listClosedTrades(
  ctx: TenantContext,
  filter: TradeFilter = {},
): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: whereClause(ctx, filter, { closedOnly: true }),
    orderBy: [{ closeAt: 'asc' }, { ticket: 'asc' }],
  });
  return rows.map(toRecord);
}

export async function countTrades(ctx: TenantContext, filter: TradeFilter = {}): Promise<number> {
  assertContext(ctx);
  return prisma.trade.count({ where: whereClause(ctx, filter) });
}

/** Paginated table view, newest first. */
export async function pageTrades(
  ctx: TenantContext,
  filter: TradeFilter,
  page: { offset: number; limit: number },
): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: whereClause(ctx, filter),
    orderBy: [{ closeAt: 'desc' }, { ticket: 'desc' }],
    skip: page.offset,
    take: page.limit,
  });
  return rows.map(toRecord);
}

/** Deposits, withdrawals and corrections — excluded from performance, shown in the balance. */
export async function listCashFlow(ctx: TenantContext): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, kind: { not: 'trade' } },
    orderBy: { openAt: 'asc' },
  });
  return rows.map(toRecord);
}

/** Wipes the book — used when the user connects a different MT5 account. */
export async function deleteAllTrades(ctx: TenantContext): Promise<number> {
  assertContext(ctx);
  const { count } = await prisma.trade.deleteMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
}

export async function newestCloseAt(ctx: TenantContext): Promise<Date | null> {
  assertContext(ctx);
  const row = await prisma.trade.findFirst({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, closeAt: { not: null } },
    orderBy: { closeAt: 'desc' },
    select: { closeAt: true },
  });
  return row?.closeAt ?? null;
}
