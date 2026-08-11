'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createLearningEntry, deleteLearningEntry } from '@/lib/db';
import { isPlausibleDate } from '@/lib/finance/bounds';
import { isBrother } from '@/lib/household';
import { LEARNING_TOPICS, normalizeTopic, topicKey } from '@/lib/learning/types';
import { LOCALES } from '@/i18n/config';

export type LearningFormState = { error?: string; ok?: boolean };

/**
 * A study session is at most a day of work, so the upper bound is a day. It is there to
 * catch a typed "800" that was meant to be "8" — a figure like that would swamp the pie and
 * make every real session look like rounding error.
 */
const MAX_HOURS = 24;

const entrySchema = z.object({
  // Free text now, and bounded rather than enumerated: the list of topics is the trader's,
  // not ours. `resolveTopic` decides whether what arrived is a built-in or their own word.
  topic: z.string().trim().min(1).max(60),
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
  /*
   * Hours and minutes arrive as two fields and leave as one number of hours, which is what the
   * column holds.
   *
   * Both are text and both may be blank: "45 minutes" is minutes with the hours empty, and an
   * hour flat is the reverse. A comma decimal still parses, because a Hebrew keyboard types
   * one and `1,5` meaning an hour and a half is not a mistake worth an error message.
   *
   * The pair is validated together rather than separately — either alone being empty is fine,
   * and what has to be true is that they add up to a real session.
   */
  hours: z.string(),
  minutes: z.string(),
  learnedOn: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((date) => isPlausibleDate(date)),
});

/**
 * Two typed fields → the number of hours to store, or null when the pair is not a session.
 *
 * Blank counts as zero on either side, so each field works alone. The result is rounded to the
 * column's four decimal places here rather than left to the database, so what is read back is
 * exactly what this function decided: 35 minutes is 0.5833 hours and reads back as 35 minutes,
 * every time, however many rows are summed.
 */
/**
 * What the form submitted → what to store.
 *
 * The topic field offers the built-ins by their *translated* labels, because that is what the
 * trader reads — so "טכני" comes back, not "technical". Storing that verbatim would put a
 * second, untranslated bucket beside the real one, and switching the interface to English
 * would leave a Hebrew word in the chart forever.
 *
 * So a submission that folds to a built-in's key or to either locale's label for it is stored
 * as the key. Anything else is the trader's own word and is kept exactly as they wrote it.
 * Both locales are checked, not just the current one: the account has two of them and a topic
 * chosen in Hebrew must still be the same topic when the screen is in English.
 */
async function resolveTopic(submitted: string): Promise<string> {
  const clean = normalizeTopic(submitted);
  if (clean === '') return '';

  const key = topicKey(clean);
  for (const locale of LOCALES) {
    const t = await getTranslations({ locale, namespace: 'learning.topics' });
    for (const known of LEARNING_TOPICS) {
      if (key === topicKey(known) || key === topicKey(t(known))) return known;
    }
  }
  return clean;
}

function totalHours(hoursField: string, minutesField: string): number | null {
  const read = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const hours = read(hoursField);
  const minutes = read(minutesField);
  if (hours === null || minutes === null) return null;

  const total = hours + minutes / 60;
  if (total <= 0 || total > MAX_HOURS) return null;
  return Math.round(total * 10_000) / 10_000;
}

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
    minutes: String(formData.get('minutes') ?? ''),
    learnedOn: String(formData.get('learnedOn') ?? ''),
  });
  if (!parsed.success) return { error: t('invalid') };

  const total = totalHours(parsed.data.hours, parsed.data.minutes);
  if (total === null) return { error: t('invalid') };

  const topic = await resolveTopic(parsed.data.topic);
  if (topic === '') return { error: t('invalid') };

  await createLearningEntry(session.ctx, {
    topic,
    title: parsed.data.title,
    note: parsed.data.note || null,
    hours: total,
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
