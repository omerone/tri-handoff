import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import type { LongPosition } from '@/lib/positions/valuation';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * Manually-entered long-term positions (SPEC §3.4).
 *
 * `currentPrice` is per unit, and `valueUpdatedAt` moves only when the user actually enters a
 * price — not on every save. That distinction is the whole point of showing the stamp: it
 * answers "how old is this number", and a timestamp that ticked on unrelated edits would
 * answer it wrongly.
 */

type Decimalish = { toString(): string };

type Row = {
  id: string;
  symbol: string;
  qty: Decimalish;
  buyPrice: Decimalish;
  buyDate: Date;
  currentPrice: Decimalish;
  valueUpdatedAt: Date;
  fees: Decimalish;
  currency: string;
  realizedPnl: Decimalish | null;
  closedAt: Date | null;
  note: string | null;
};

function toPosition(row: Row): LongPosition {
  return {
    id: row.id,
    symbol: row.symbol,
    qty: Number(row.qty),
    buyPrice: Number(row.buyPrice),
    buyDate: row.buyDate,
    currentPrice: Number(row.currentPrice),
    valueUpdatedAt: row.valueUpdatedAt,
    fees: Number(row.fees),
    currency: row.currency,
    realizedPnl: row.realizedPnl === null ? null : Number(row.realizedPnl),
    closedAt: row.closedAt,
    note: row.note,
  };
}

export async function listLongPositions(ctx: TenantContext): Promise<LongPosition[]> {
  assertContext(ctx);
  const rows = await prisma.longPosition.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    // Open first, then most recently bought. `nulls: 'first'` is load-bearing: Postgres
    // sorts NULLs *last* on ASC, so a plain `closedAt: 'asc'` returned closed positions
    // ahead of open ones — the opposite of what the ordering claims.
    orderBy: [{ closedAt: { sort: 'asc', nulls: 'first' } }, { buyDate: 'desc' }],
  });
  return rows.map(toPosition);
}

export type LongPositionInput = {
  symbol: string;
  qty: number;
  buyPrice: number;
  buyDate: Date;
  fees: number;
  currency: string;
  note?: string | null;
};

export async function createLongPosition(
  ctx: TenantContext,
  input: LongPositionInput,
): Promise<LongPosition> {
  assertContext(ctx);
  const row = await prisma.longPosition.create({
    data: {
      userId: ctx.userId,
      symbol: input.symbol,
      qty: input.qty,
      buyPrice: input.buyPrice,
      buyDate: input.buyDate,
      // A new position is worth what it was bought for until the user says otherwise —
      // starting at zero would show a 100% loss on day one.
      currentPrice: input.buyPrice,
      valueUpdatedAt: new Date(),
      fees: input.fees,
      currency: input.currency,
      note: input.note ?? null,
    },
  });
  return toPosition(row);
}

/** The manual mark-to-market. Stamps `valueUpdatedAt`, which nothing else does. */
export async function updateCurrentPrice(
  ctx: TenantContext,
  id: string,
  currentPrice: number,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, closedAt: null },
    data: { currentPrice, valueUpdatedAt: new Date() },
  });
  return count > 0;
}

/**
 * Closes a position at a sale price.
 *
 * The realized figure is stored rather than recomputed later, because it is a fact about a
 * transaction that happened — if the user edits the buy price afterwards, last year's
 * realized gain should not change.
 */
export async function closeLongPosition(
  ctx: TenantContext,
  id: string,
  params: { sellPrice: number; realizedPnl: number; closedAt: Date },
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, closedAt: null },
    data: {
      currentPrice: params.sellPrice,
      valueUpdatedAt: params.closedAt,
      realizedPnl: params.realizedPnl,
      closedAt: params.closedAt,
    },
  });
  return count > 0;
}

export async function deleteLongPosition(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count > 0;
}

export async function getLongPosition(
  ctx: TenantContext,
  id: string,
): Promise<LongPosition | null> {
  assertContext(ctx);
  const row = await prisma.longPosition.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return row ? toPosition(row) : null;
}
