import { normalizeTopic, topicKey } from '@/lib/learning/types';
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
  learner: string | null;
};

const toEntry = (row: Row): LearningEntry => ({
  id: row.id,
  topic: row.topic,
  title: row.title,
  note: row.note,
  hours: Number(row.hours),
  learnedOn: row.learnedOn,
  learner: row.learner,
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
  /** Who studied. Null when the session was recorded without a name. */
  learner: string | null;
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

/**
 * Rewrites one session in place.
 *
 * `updateMany` rather than `update`: it takes a WHERE that can carry the tenant scope, and
 * returns 0 instead of throwing when the row belongs to somebody else — the same shape the
 * finance ledger already uses, and the reason a mistyped id is a no-op rather than a leak.
 *
 * Every field is written, none is optional. A partial update would let a form that lost a
 * field on the way in blank it silently; the screen sends the whole row back because the whole
 * row is what it showed.
 */
export async function updateLearningEntry(
  ctx: TenantContext,
  id: string,
  input: LearningEntryInput,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.learningEntry.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: input,
  });
  return count > 0;
}

/** One session, for the form that is about to rewrite it. */
export async function findLearningEntry(
  ctx: TenantContext,
  id: string,
): Promise<LearningEntry | null> {
  assertContext(ctx);
  const row = await prisma.learningEntry.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return row ? toEntry(row) : null;
}

/** Returns false when the row does not belong to this context, rather than throwing. */
/**
 * The rows a user picked out of the list, in one statement.
 *
 * One `deleteMany` rather than a loop: a screenful of rows should cost one query, and a partial
 * failure halfway through a loop leaves a list the person has to re-read to find out what
 * happened. Scoped inside the statement, so an id belonging to another tenant matches nothing
 * rather than relying on a check that could be forgotten at a call site.
 */
export async function deleteLearningEntriesByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<number> {
  assertContext(ctx);
  if (ids.length === 0) return 0;
  const { count } = await prisma.learningEntry.deleteMany({
    where: { id: { in: [...ids] }, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
}

export async function deleteLearningEntry(ctx: TenantContext, id: string): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.learningEntry.deleteMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count > 0;
}

/**
 * Every topic this trader has actually used, most recent first.
 *
 * The same idea as `listJournalVocabulary`: the form offers what has been typed before so a
 * topic is chosen rather than re-typed, which is what stops "Back test" and "Backtest" being
 * two rows in the chart. Folded on `topicKey`, keeping the first spelling seen.
 *
 * The two built-ins are not added here — the form lists them itself, so this stays a record
 * of what the trader has written rather than a mix of theirs and ours.
 */
export async function listLearningTopics(ctx: TenantContext): Promise<string[]> {
  assertContext(ctx);
  const rows = await prisma.learningEntry.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    select: { topic: true },
    // Oldest first, so the spelling kept is the one that named the topic — the same rule
    // `groupByTopic` follows, or the suggestion list and the chart would disagree about what
    // the topic is called.
    orderBy: { learnedOn: 'asc' },
    take: 500,
  });

  const seen = new Map<string, string>();
  for (const row of rows) {
    const clean = normalizeTopic(row.topic);
    const key = topicKey(clean);
    if (key !== '' && !seen.has(key)) seen.set(key, clean);
  }
  return [...seen.values()].reverse();
}
