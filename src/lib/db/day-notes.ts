import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';
import { toIsoDate } from '@/lib/time/format';
import { assertContext } from './context';
import { prisma } from './prisma';

export type DayNote = {
  /** `yyyy-mm-dd`, as the week module works in. */
  day: string;
  body: string;
};

/** A `@db.Date` comes back as midnight UTC — a calendar date, read back in UTC. */
const dayOf = (value: Date) =>
  toIsoDate({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  });

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * The notes across a span of days, keyed by the day they are about.
 *
 * A map rather than a list because that is how the caller uses it: the week draws seven cards
 * and asks each one "is there a note on you". Returning an array would make the page do that
 * lookup seven times against a list it just received.
 */
export async function listDayNotes(
  ctx: TenantContext,
  owner: string | null,
  from: string,
  to: string,
): Promise<Map<string, string>> {
  assertContext(ctx);
  const rows = await prisma.dayNote.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      owner,
      day: { gte: utc(from), lte: utc(to) },
    },
    select: { day: true, body: true },
  });
  return new Map(rows.map((row) => [dayOf(row.day), row.body]));
}

/**
 * Writes the note on a day, or removes it when there is nothing left to say.
 *
 * An empty body deletes rather than storing a blank. A row holding an empty string is a note
 * to every query that counts them and to nobody reading the screen, and clearing the field is
 * how a person deletes a note — there is no other gesture for it, so this is the one.
 *
 * Two write paths for one rule, the same shape the budgets use: the composite unique cannot
 * name a null owner — Postgres treats NULLs as distinct and Prisma refuses them in an upsert's
 * unique key — so a household of one goes find-then-write under the partial index
 * `day_notes_user_id_day_solo_key`, which enforces the same one-note-per-day fact.
 */
export async function setDayNote(
  ctx: TenantContext,
  input: { owner: string | null; day: string; body: string },
): Promise<void> {
  assertContext(ctx);
  const body = input.body.trim();

  if (body === '') {
    await prisma.dayNote.deleteMany({
      where: {
        userId: ctx.userId,
        user: { tenantId: ctx.tenantId },
        owner: input.owner,
        day: utc(input.day),
      },
    });
    return;
  }

  if (input.owner === null) {
    const existing = await prisma.dayNote.findFirst({
      where: {
        userId: ctx.userId,
        user: { tenantId: ctx.tenantId },
        owner: null,
        day: utc(input.day),
      },
      select: { id: true },
    });

    if (existing) await prisma.dayNote.update({ where: { id: existing.id }, data: { body } });
    else await prisma.dayNote.create({ data: { userId: ctx.userId, owner: null, day: utc(input.day), body } });
    return;
  }

  await prisma.dayNote.upsert({
    where: {
      userId_owner_day: { userId: ctx.userId, owner: input.owner, day: utc(input.day) },
    },
    create: { userId: ctx.userId, owner: input.owner, day: utc(input.day), body },
    update: { body },
  });
}
