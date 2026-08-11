'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createLearningEntry, deleteLearningEntry } from '@/lib/db';
import { isPlausibleDate } from '@/lib/finance/bounds';
import { isBrother } from '@/lib/household';

export type LearningFormState = { error?: string; ok?: boolean };

/**
 * A study session is at most a day of work, so the upper bound is a day. It is there to
 * catch a typed "800" that was meant to be "8" — a figure like that would swamp the pie and
 * make every real session look like rounding error.
 */
const MAX_HOURS = 24;

const entrySchema = z.object({
  topic: z.enum(['psychology', 'technical']),
  /**
   * Who studied. Always one of the two brothers, refused otherwise — the same rule the
   * finance action applies, and it was briefly looser here: this field accepted any string
   * while the screens filter on exactly two names, so a crafted POST — or a stale form cached
   * from the build that still had a free-text field — wrote a session that no view would ever
   * show again. A row that cannot be seen cannot be corrected, which is worse than an error.
   */
  learner: z.string().refine(isBrother),
  title: z.string().trim().min(1).max(120),
  note: z.string().trim().max(2_000),
  // The field is text so a comma decimal typed on a Hebrew keyboard still parses.
  hours: z
    .string()
    .transform((value) => Number(value.replace(',', '.')))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= MAX_HOURS),
  learnedOn: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((date) => isPlausibleDate(date)),
});

export async function createLearningEntryAction(
  _prev: LearningFormState,
  formData: FormData,
): Promise<LearningFormState> {
  const session = await requireSession();
  const t = await getTranslations('learning');

  const parsed = entrySchema.safeParse({
    topic: formData.get('topic'),
    learner: formData.get('learner') ?? '',
    title: formData.get('title') ?? '',
    note: formData.get('note') ?? '',
    hours: String(formData.get('hours') ?? ''),
    learnedOn: String(formData.get('learnedOn') ?? ''),
  });
  if (!parsed.success) return { error: t('invalid') };

  await createLearningEntry(session.ctx, {
    topic: parsed.data.topic,
    title: parsed.data.title,
    note: parsed.data.note || null,
    hours: parsed.data.hours,
    learnedOn: parsed.data.learnedOn,
    learner: parsed.data.learner,
  });

  revalidatePath('/learning');
  // The hours pie lives on the analytics screen, so that is stale now too.
  revalidatePath('/analytics');
  return { ok: true };
}

export async function deleteLearningEntryAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteLearningEntry(session.ctx, id);
  revalidatePath('/learning');
  revalidatePath('/analytics');
}
