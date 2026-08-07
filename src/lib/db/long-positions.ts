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
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
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
  /**
   * The trader's own words about the holding — the same five columns a synced trade carries.
   *
   * Out of `LongPosition` for the same reason `priceSource` is: the valuation has no business
   * knowing what someone wrote about why they bought.
   */
  journal: LongPositionJournal;
};

/** The five journal columns, by the same names the trades table uses. */
export type LongPositionJournal = {
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
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
    journal: {
      note: row.note,
      tags: row.tags ?? [],
      rating: row.rating,
      mood: row.mood,
      strategy: row.strategy,
    },
  };
}

/**
 * Writes the journal, and nothing else.
 *
 * Its own function rather than a branch of a general update, for the same reason
 * `updateTradeJournal` is: these five columns are the only ones on this row that a person
 * typed, and the quote refresh writes `currentPrice` on a timer. Keeping the two writers
 * apart is what stops a save of someone's notes carrying a stale price back over a fresh one.
 */
export async function updateLongPositionJournal(
  ctx: TenantContext,
  id: string,
  journal: LongPositionJournal,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: journal,
  });
  return count > 0;
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
 * The facts of a holding that the trader owns and may correct.
 *
 * Every field here was typed by a person, which is what makes all of it editable — a holding
 * has no broker behind it to be the source of truth. The two nullable ones are the close: a
 * position still open has neither, and one closed on the wrong date or at the wrong price has
 * both wrong together.
 */
export type LongPositionEdit = {
  symbol: string;
  qty: number;
  buyPrice: number;
  buyDate: Date;
  fees: number;
  currency: string;
  /** Per-unit, as stored. Editing it is how someone marks an untracked holding by hand. */
  currentPrice: number;
  /** Both null for an open position; both set for a closed one. */
  realizedPnl: number | null;
  closedAt: Date | null;
};

/**
 * Corrects a holding — the "I got the numbers wrong" path.
 *
 * Deliberately separate from `updateCurrentPrice` and `closeLongPosition`, which each write
 * one thing and are reached from a single button. This writes the whole record, including
 * clearing a close to reopen a position, which is the only way back from a mis-clicked
 * "close".
 *
 * **The journal is not in the write**, for the reason `updateLongPositionJournal` already
 * gives: two writers on one row is how a save of one thing carries a stale copy of another.
 *
 * **Changing the price drops the holding to `manual`**, and only then. The same rule
 * `updateCurrentPrice` follows — a trader correcting a number and the feed overwriting it a
 * minute later is the one outcome nobody wants — but an edit that touched only the quantity
 * must not stamp `valueUpdatedAt`, or a three-week-old price would look like it was checked
 * today. That stamp is the whole point of showing it.
 */
export async function updateLongPosition(
  ctx: TenantContext,
  id: string,
  input: LongPositionEdit,
): Promise<boolean> {
  assertContext(ctx);

  const existing = await prisma.longPosition.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    select: { currentPrice: true },
  });
  if (!existing) return false;

  const priceChanged = Number(existing.currentPrice) !== input.currentPrice;

  const { count } = await prisma.longPosition.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: {
      symbol: input.symbol,
      qty: input.qty,
      buyPrice: input.buyPrice,
      buyDate: input.buyDate,
      fees: input.fees,
      currency: input.currency,
      currentPrice: input.currentPrice,
      realizedPnl: input.realizedPnl,
      closedAt: input.closedAt,
      ...(priceChanged ? { valueUpdatedAt: new Date(), priceSource: 'manual' } : {}),
    },
  });
  return count > 0;
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

/**
 * Several holdings at once, for the trades table's multi-select.
 *
 * A holding appears in that table only once it is closed, so this is deleting realised
 * history rather than a position someone is still holding — and unlike a synced trade there
 * is nothing that could bring it back, because nobody but the trader ever wrote it.
 */
export async function deleteLongPositionsByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<number> {
  assertContext(ctx);
  if (ids.length === 0) return 0;
  const { count } = await prisma.longPosition.deleteMany({
    where: { id: { in: [...ids] }, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
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

/**
 * Closed positions whose sale falls inside a window — what the trades table folds in
 * alongside real deals.
 *
 * Ordered by close date descending to match the trades table, and narrowed on `closedAt`
 * rather than `buyDate` because that table is a record of what was *realised* in the period.
 * A holding bought two years ago and sold last week belongs to last week.
 */
export async function listClosedLongPositions(
  ctx: TenantContext,
  window: { from?: Date; to?: Date } = {},
): Promise<StoredLongPosition[]> {
  assertContext(ctx);
  const rows = await prisma.longPosition.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      closedAt: {
        not: null,
        ...(window.from ? { gte: window.from } : {}),
        ...(window.to ? { lte: window.to } : {}),
      },
    },
    orderBy: [{ closedAt: 'desc' }],
    take: 5000,
  });
  return rows.map(toPosition);
}
