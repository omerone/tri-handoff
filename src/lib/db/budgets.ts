import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

export type Budget = {
  id: string;
  /** The member this ceiling belongs to; null in a household of one. */
  owner: string | null;
  category: string;
  /** A month's ceiling, in `currency` — see the model. */
  amount: number;
  currency: string;
};

/**
 * One brother's ceilings.
 *
 * Scoped by owner as well as by tenant, because the money is separate: showing Yoni's
 * allowances on Evyatar's screen would be the same mistake the ledger already avoids, and
 * this is the screen where it would look most authoritative.
 */
export async function listBudgets(ctx: TenantContext, owner: string | null): Promise<Budget[]> {
  assertContext(ctx);
  const rows = await prisma.budget.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, owner },
    orderBy: { category: 'asc' },
    select: { id: true, owner: true, category: true, amount: true, currency: true },
  });
  return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
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
  input: { owner: string | null; category: string; amount: number; currency: string },
): Promise<void> {
  assertContext(ctx);
  /*
   * Two write paths for one rule. The composite unique cannot name a null owner — Postgres
   * treats NULLs as distinct and Prisma refuses them in an upsert's unique key — so the solo
   * branch is find-then-write under the partial index `budgets_user_id_category_solo_key`,
   * which enforces the same one-ceiling-per-category fact the upsert enforces for members.
   */
  if (input.owner === null) {
    const existing = await prisma.budget.findFirst({
      where: {
        userId: ctx.userId,
        user: { tenantId: ctx.tenantId },
        owner: null,
        category: input.category,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.budget.update({
        where: { id: existing.id },
        data: { amount: input.amount, currency: input.currency },
      });
    } else {
      await prisma.budget.create({
        data: {
          userId: ctx.userId,
          owner: null,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
        },
      });
    }
    return;
  }

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
      amount: input.amount,
      currency: input.currency,
    },
    // The currency moves with the figure: re-setting "food" to $500 must not leave it
    // measured in shekels, which would read as a fourfold cut nobody asked for.
    update: { amount: input.amount, currency: input.currency },
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
  amount: number,
): Promise<void> {
  assertContext(ctx);
  await prisma.budget.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { amount },
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
