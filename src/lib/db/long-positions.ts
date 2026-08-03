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
  priceSource: string;
  micCode: string;
};

/**
 * A position as stored, which is a superset of what valuing one needs.
 *
 * `priceSource` and `micCode` say where the price comes from, not what it is worth, so they
 * stay out of the pure `LongPosition` the valuation works on — that module has no business
 * knowing a market-data feed exists.
 */
export type StoredLongPosition = LongPosition & {
  /** `auto` — the quote refresh owns `currentPrice`. `manual` — the user does. */
  priceSource: 'auto' | 'manual';
  /** Which listing the price comes from. Empty for manual positions and crypto pairs. */
  micCode: string;
};

function toPosition(row: Row): StoredLongPosition {
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
    priceSource: row.priceSource === 'auto' ? 'auto' : 'manual',
    micCode: row.micCode,
  };
}

export async function listLongPositions(ctx: TenantContext): Promise<StoredLongPosition[]> {
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
  /** Set when the symbol was picked from the search, which is what makes it priceable. */
  micCode?: string;
  priceSource?: 'auto' | 'manual';
};

export async function createLongPosition(
  ctx: TenantContext,
  input: LongPositionInput,
): Promise<StoredLongPosition> {
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
      micCode: input.micCode ?? '',
      priceSource: input.priceSource ?? 'manual',
    },
  });
  return toPosition(row);
}

/**
 * The manual mark-to-market. Stamps `valueUpdatedAt`, which nothing else does.
 *
 * Typing a price also takes the position off the feed. Anything else means a user correcting
 * a number watches the refresh overwrite it a minute later, with no way to tell why — and
 * "the price I entered went away" is a bug report nobody can act on.
 */
export async function updateCurrentPrice(
  ctx: TenantContext,
  id: string,
  currentPrice: number,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, closedAt: null },
    data: { currentPrice, valueUpdatedAt: new Date(), priceSource: 'manual' },
  });
  return count > 0;
}

/**
 * Puts a position back on the feed, or takes it off.
 *
 * The way back from the rule above: without it, one correction to a tracked holding would
 * strand it on manual updates forever.
 */
export async function setPriceSource(
  ctx: TenantContext,
  id: string,
  priceSource: 'auto' | 'manual',
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, closedAt: null },
    data: { priceSource },
  });
  return count > 0;
}

/**
 * Puts every open position that is still on manual pricing onto the feed.
 *
 * The migration path. A book built before there was a price feed is a hundred positions with
 * no MIC, and asking someone to click a hundred toggles — or to delete and re-add a hundred
 * holdings — is not a migration, it is a reason not to use the feature. Positions carry no
 * MIC afterwards either, which is the right answer for a US book: the feed reads a bare
 * ticker as its primary listing, and a quote in the wrong currency is refused rather than
 * applied.
 *
 * Returns how many moved, so the UI can say.
 */
export async function trackAllOpenPositions(ctx: TenantContext): Promise<number> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      closedAt: null,
      priceSource: 'manual',
    },
    data: { priceSource: 'auto' },
  });
  return count;
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
): Promise<StoredLongPosition | null> {
  assertContext(ctx);
  const row = await prisma.longPosition.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return row ? toPosition(row) : null;
}
