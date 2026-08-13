import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import type { FinanceEntry } from '@/lib/finance/balance';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * Personal-finance entries. ILS-native (SPEC §3.1); the display currency is applied at
 * render, not stored.
 *
 * Reads are unfiltered by month on purpose: a recurring row anchored in January contributes
 * to every month after it, so "the entries for July" cannot be expressed as a date range —
 * the expansion in lib/finance/recurring.ts needs the whole set. For a personal budget that
 * is tens of rows.
 */

type FinanceRow = {
  id: string;
  type: 'income' | 'expense';
  category: string;
  label: string;
  owner: string | null;
  amountIls: { toString(): string };
  entryDate: Date;
  isRecurring: boolean;
  recurringUntil: Date | null;
};

function toEntry(row: FinanceRow): FinanceEntry {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    label: row.label,
    owner: row.owner,
    amountIls: Number(row.amountIls),
    entryDate: row.entryDate,
    isRecurring: row.isRecurring,
    recurringUntil: row.recurringUntil,
  };
}

export async function listFinanceEntries(
  ctx: TenantContext,
  /**
   * One brother's money, or everyone's.
   *
   * Undefined and null both mean "no filter" — a repository-level answer with no screen
   * behind it any more: the switch always rests on a brother, and the action refuses a row
   * without one. Kept for the tests and for tooling that legitimately reads the whole table;
   * a null-owned row, should one ever exist again, is reachable only from here.
   */
  owner?: string | null,
): Promise<FinanceEntry[]> {
  assertContext(ctx);
  const rows = await prisma.financeEntry.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      ...(owner ? { owner } : {}),
    },
    orderBy: { entryDate: 'asc' },
  });
  return rows.map(toEntry);
}

export type FinanceEntryInput = {
  type: 'income' | 'expense';
  category: string;
  label: string;
  /** Which brother the money belongs to; null is a deliberately shared row. */
  owner: string | null;
  amountIls: number;
  entryDate: Date;
  isRecurring: boolean;
  recurringUntil?: Date | null;
};

export async function createFinanceEntry(
  ctx: TenantContext,
  input: FinanceEntryInput,
): Promise<FinanceEntry> {
  assertContext(ctx);
  const row = await prisma.financeEntry.create({
    data: {
      userId: ctx.userId,
      type: input.type,
      category: input.category,
      label: input.label,
      owner: input.owner,
      amountIls: input.amountIls,
      entryDate: input.entryDate,
      isRecurring: input.isRecurring,
      recurringUntil: input.recurringUntil ?? null,
    },
  });
  return toEntry(row);
}

/** What a correction is allowed to change. Deliberately not `FinanceEntryInput`. */
export type FinanceCorrection = {
  type: 'income' | 'expense';
  label: string;
  category: string;
  amountIls: number;
  /** Left out for a recurring row — see below. */
  entryDate?: Date;
};

/**
 * Corrects what a row says, not what it is.
 *
 * There used to be a general `updateFinanceEntry` here, taking the same input as the create.
 * It was unreachable from any screen, and the comment beside the actions explained why: it
 * wrote `recurringUntil: input.recurringUntil ?? null`, so anything that called it without
 * carrying that field forward would silently re-open a series somebody had deliberately
 * ended — retroactively adding every month after the end date. That is a loaded gun in a
 * drawer, so it is gone rather than guarded.
 *
 * This one cannot do it, by not being able to say it: `isRecurring` and `recurringUntil` are
 * absent from the type, so no correction reaches them. Whether a row is a rule or a record,
 * and how long the rule runs, are changed by the controls that exist for that — the recurring
 * box when it is written, and "end series" afterwards.
 *
 * `entryDate` is optional for the same reason. A recurring row's date is the anchor its
 * months are counted from, and the editor is opened from an arbitrary occurrence; moving it
 * from there would shift every other month by the difference. Omitting the key leaves the
 * column alone rather than writing it back.
 */
export async function correctFinanceEntry(
  ctx: TenantContext,
  id: string,
  input: FinanceCorrection,
): Promise<boolean> {
  assertContext(ctx);
  // updateMany rather than update: it takes a WHERE that can carry the tenant scope, and
  // returns 0 instead of throwing when the row belongs to someone else.
  const { count } = await prisma.financeEntry.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: {
      type: input.type,
      category: input.category,
      label: input.label,
      amountIls: input.amountIls,
      ...(input.entryDate ? { entryDate: input.entryDate } : {}),
    },
  });
  return count > 0;
}

/**
 * The rows a user picked out of the list, in one statement.
 *
 * One `deleteMany` rather than a loop: a screenful of rows should cost one query, and a partial
 * failure halfway through a loop leaves a list the person has to re-read to find out what
 * happened. Scoped inside the statement, so an id belonging to another tenant matches nothing
 * rather than relying on a check that could be forgotten at a call site.
 */
export async function deleteFinanceEntriesByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<number> {
  assertContext(ctx);
  if (ids.length === 0) return 0;
  const { count } = await prisma.financeEntry.deleteMany({
    where: { id: { in: [...ids] }, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
}

export async function deleteFinanceEntry(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.financeEntry.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count > 0;
}

/**
 * Ends a recurring series at the end of the given month instead of deleting it.
 *
 * Deleting a salary row because the job ended would erase it from every past month too, and
 * last year's balance would silently change. Closing the series keeps history intact.
 */
export async function endRecurringSeries(
  ctx: TenantContext,
  id: string,
  lastMonth: { year: number; month: number },
): Promise<boolean> {
  assertContext(ctx);
  const lastDay = new Date(Date.UTC(lastMonth.year, lastMonth.month, 0));
  const { count } = await prisma.financeEntry.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId }, isRecurring: true },
    data: { recurringUntil: lastDay },
  });
  return count > 0;
}
