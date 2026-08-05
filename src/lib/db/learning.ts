import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import type { LearningEntry, LearningTopic } from '@/lib/learning/types';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * The study ledger.
 *
 * Scoped by `ctx.userId` *and* joined back to `ctx.tenantId`, like every other query in this
 * directory: a context that somehow paired one tenant with another's user still selects
 * nothing.
 */

type Row = {
  id: string;
  topic: LearningTopic;
  title: string;
  note: string | null;
  hours: unknown;
  learnedOn: Date;
};

const toEntry = (row: Row): LearningEntry => ({
  id: row.id,
  topic: row.topic,
  title: row.title,
  note: row.note,
  hours: Number(row.hours),
  learnedOn: row.learnedOn,
});

export type LearningWindow = { from?: Date; to?: Date };

/**
 * Sessions inside a window, newest first.
 *
 * Bounded by `learnedOn` rather than by when the row was written, because a trader catching up
 * on a week of notes on Sunday still studied on the days they say they did.
 */
export async function listLearningEntries(
  ctx: TenantContext,
  window: LearningWindow = {},
): Promise<LearningEntry[]> {
  assertContext(ctx);
  const rows = await prisma.learningEntry.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      ...(window.from || window.to
        ? {
            learnedOn: {
              ...(window.from ? { gte: window.from } : {}),
              ...(window.to ? { lte: window.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ learnedOn: 'desc' }, { createdAt: 'desc' }],
    take: 5000,
  });
  return rows.map(toEntry);
}

export type LearningEntryInput = {
  topic: LearningTopic;
  title: string;
  note: string | null;
  hours: number;
  learnedOn: Date;
};

export async function createLearningEntry(
  ctx: TenantContext,
  input: LearningEntryInput,
): Promise<LearningEntry> {
  assertContext(ctx);
  const row = await prisma.learningEntry.create({
    data: { userId: ctx.userId, ...input },
  });
  return toEntry(row);
}

/** Returns false when the row does not belong to this context, rather than throwing. */
export async function deleteLearningEntry(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.learningEntry.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count > 0;
}
