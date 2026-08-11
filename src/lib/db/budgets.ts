import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import type { Brother } from '@/lib/household';
import { assertContext } from './context';
import { prisma } from './prisma';

export type Budget = {
  id: string;
  owner: string;
  category: string;
  /** Shekels a month. */
  amountIls: number;
};

/**
 * One brother's ceilings.
 *
 * Scoped by owner as well as by tenant, because the money is separate: showing Yoni's
 * allowances on Evyatar's screen would be the same mistake the ledger already avoids, and
 * this is the screen where it would look most authoritative.
 */
export async function listBudgets(ctx: TenantContext, owner: Brother): Promise<Budget[]> {
  assertContext(ctx);
  const rows = await prisma.budget.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, owner },
    orderBy: { category: 'asc' },
    select: { id: true, owner: true, category: true, amountIls: true },
  });
  return rows.map((row) => ({ ...row, amountIls: Number(row.amountIls) }));
}

/**
 * Sets a ceiling, or moves one that already exists.
 *
 * An upsert rather than a create, because "budget for food" is one fact about a month and
 * setting it twice is a correction. A second row would silently double the allowance and the
 * screen would have no way to show that it had.
 */
export async function setBudget(
  ctx: TenantContext,
  input: { owner: Brother; category: string; amountIls: number },
): Promise<void> {
  assertContext(ctx);
  await prisma.budget.upsert({
    where: {
      userId_owner_category: {
        userId: ctx.userId,
        owner: input.owner,
        category: input.category,
      },
    },
    create: {
      userId: ctx.userId,
      owner: input.owner,
      category: input.category,
      amountIls: input.amountIls,
    },
    update: { amountIls: input.amountIls },
  });
}

/**
 * Moves a ceiling that already exists, by id.
 *
 * Separate from `setBudget` because editing one on screen is a different act from writing a
 * new one: the category is not retyped, so it cannot be mistyped into a second budget
 * standing beside the first with the spending split between them.
 */
export async function setBudgetAmount(
  ctx: TenantContext,
  id: string,
  amountIls: number,
): Promise<void> {
  assertContext(ctx);
  await prisma.budget.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { amountIls },
  });
}

/**
 * Removes a ceiling. Scoped by the context as well as by id, so an id from anywhere else
 * matches nothing — the same rule every delete in this directory follows.
 */
export async function deleteBudget(ctx: TenantContext, id: string): Promise<void> {
  assertContext(ctx);
  await prisma.budget.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
}
