import 'server-only';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * The account's balance over time, one point per day.
 *
 * Written by the sync and read by the dashboard. See the model header in schema.prisma for
 * why this exists alongside the equity curve rather than instead of it: the curve is built
 * from trades and deliberately ignores deposits, which makes it the right thing for judging
 * *trading* and the wrong thing for answering "what was the account worth in March".
 */

export type AccountSnapshot = {
  at: Date;
  balance: number;
  equity: number | null;
  currency: string;
};

const num = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

/** Midnight UTC of the day an instant falls in — the key one row per day is enforced on. */
export function snapshotDay(instant: Date): Date {
  return new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
}

/**
 * Records what the broker just said, once per day.
 *
 * An upsert rather than an insert: the sync runs on every login and whenever the trader
 * presses refresh, and six points for Tuesday is six times the rows for none of the
 * information. The last reading of the day wins, which is the one closest to the close.
 *
 * Deliberately not throwing. This is bookkeeping hanging off the end of a sync that has
 * already succeeded and already stored the trades; a unique-constraint race between two tabs
 * refreshing at once must not turn a good sync into a failed one.
 */
export async function recordSnapshot(
  ctx: TenantContext,
  state: { at?: Date; balance: number; equity: number | null; currency: string },
): Promise<void> {
  assertContext(ctx);
  const at = snapshotDay(state.at ?? new Date());

  try {
    await prisma.accountSnapshot.upsert({
      where: { userId_at: { userId: ctx.userId, at } },
      create: {
        userId: ctx.userId,
        at,
        balance: state.balance,
        equity: state.equity,
        currency: state.currency,
      },
      update: { balance: state.balance, equity: state.equity, currency: state.currency },
    });
  } catch (error) {
    console.error(
      '[snapshots] could not record the daily balance:',
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * The points in a window, oldest first.
 *
 * Capped, like the trade queries, at a number no retail account reaches: one row per day is
 * about 3,650 for a decade of daily trading.
 */
export async function listSnapshots(
  ctx: TenantContext,
  window: { from?: Date; to?: Date } = {},
): Promise<AccountSnapshot[]> {
  assertContext(ctx);

  const at: Prisma.DateTimeFilter = {};
  if (window.from) at.gte = snapshotDay(window.from);
  if (window.to) at.lte = snapshotDay(window.to);

  const rows = await prisma.accountSnapshot.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      ...(Object.keys(at).length > 0 ? { at } : {}),
    },
    orderBy: { at: 'asc' },
    take: 5000,
    select: { at: true, balance: true, equity: true, currency: true },
  });

  return rows.map((row) => ({
    at: row.at,
    balance: Number(row.balance),
    equity: num(row.equity),
    currency: row.currency,
  }));
}

/** Wipes the history. Used when a different broker account replaces the connected one. */
export async function deleteAllSnapshots(ctx: TenantContext): Promise<number> {
  assertContext(ctx);
  const { count } = await prisma.accountSnapshot.deleteMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
}
