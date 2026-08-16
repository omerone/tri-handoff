import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import { toIsoDate } from '@/lib/time/format';
import { assertContext } from './context';
import { prisma } from './prisma';

export type Goal = {
  id: string;
  /** The member this goal belongs to; null in a household of one. */
  owner: string | null;
  title: string;
  /** `yyyy-mm-dd`, as the week module works in. */
  dueOn: string;
  done: boolean;
};

/**
 * A `@db.Date` comes back as midnight UTC — a calendar date, so it is read back in UTC, and
 * through the time module like every other date in the product.
 */
const dayOf = (value: Date) =>
  toIsoDate({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  });
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * One brother's goals over a span of days.
 *
 * Scoped by owner as well as by tenant, for the same reason the ledger is: two brothers share
 * this login and their weeks are their own. A checklist is a more personal document than a
 * bank statement, and showing one on the other's screen would be the worse mistake.
 *
 * The span is inclusive at both ends and given as dates, so the caller asks for "this week"
 * or "the last six" without this having to know which.
 */
export async function listGoals(
  ctx: TenantContext,
  /**
   * A member's name, or null for a household of one. Null matches only null — Prisma turns
   * it into IS NULL — so a solo screen cannot pick up an owned row or the other way round.
   */
  owner: string | null,
  from: string,
  to: string,
): Promise<Goal[]> {
  assertContext(ctx);
  const rows = await prisma.goal.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      owner,
      dueOn: { gte: utc(from), lte: utc(to) },
    },
    // Written order within a day: a checklist is a list somebody wrote, and re-sorting it by
    // anything else moves the item they are looking at while they are looking at it.
    orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, owner: true, title: true, dueOn: true, doneAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    owner: row.owner,
    title: row.title,
    dueOn: dayOf(row.dueOn),
    done: row.doneAt !== null,
  }));
}

export async function createGoal(
  ctx: TenantContext,
  input: { owner: string | null; title: string; dueOn: string },
): Promise<void> {
  assertContext(ctx);
  await prisma.goal.create({
    data: {
      userId: ctx.userId,
      owner: input.owner,
      title: input.title,
      dueOn: utc(input.dueOn),
    },
  });
}

/**
 * Ticks a goal, or unticks it.
 *
 * The timestamp is written on the way in and cleared on the way out, rather than a boolean
 * being flipped, because "when" is the fact a streak is ever computed from and it cannot be
 * recovered later. Unticking discards it: an accidental tick is the ordinary reason to untick,
 * and keeping the time it happened would put a fiction in the record.
 */
export async function setGoalDone(ctx: TenantContext, id: string, done: boolean): Promise<void> {
  assertContext(ctx);
  await prisma.goal.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { doneAt: done ? new Date() : null },
  });
}

/** Corrects what a goal says and which day it sits on. Never touches whether it was done. */
export async function editGoal(
  ctx: TenantContext,
  id: string,
  input: { title: string; dueOn: string },
): Promise<void> {
  assertContext(ctx);
  await prisma.goal.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { title: input.title, dueOn: utc(input.dueOn) },
  });
}

export async function deleteGoal(ctx: TenantContext, id: string): Promise<void> {
  assertContext(ctx);
  await prisma.goal.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
}
