'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createGoal, deleteGoal, editGoal, setGoalDone } from '@/lib/db';
import { isBrother } from '@/lib/household';

export type GoalFormState = { error?: string; ok?: boolean };

/**
 * A day, as the week module writes them.
 *
 * Bounded to a decade either side of the epoch it is read in. A goal is something to do this
 * week; a date in 1970 or 3000 is a tampered field or a typo, and the week arithmetic would
 * happily draw a grid for either.
 */
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((iso) => {
    const year = Number(iso.slice(0, 4));
    return year >= 2020 && year <= 2100 && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`));
  });

const newGoalSchema = z.object({
  owner: z.string().refine(isBrother),
  title: z.string().trim().min(1).max(160),
  dueOn: daySchema,
});

export async function createGoalAction(
  _prev: GoalFormState,
  formData: FormData,
): Promise<GoalFormState> {
  const session = await requireSession();
  const t = await getTranslations('goals');

  const parsed = newGoalSchema.safeParse({
    owner: formData.get('owner') ?? '',
    title: formData.get('title') ?? '',
    dueOn: formData.get('dueOn') ?? '',
  });
  if (!parsed.success) return { error: t('invalid') };

  await createGoal(session.ctx, parsed.data);
  revalidatePath('/goals');
  return { ok: true };
}

/**
 * Ticking one off.
 *
 * The next state is posted rather than toggled from what the server finds. A toggle computed
 * on the server turns a double-tap on a phone — or a retried request — into a tick and an
 * untick, and the box lands back where it started with nothing to say why.
 */
export async function setGoalDoneAction(id: string, done: boolean): Promise<void> {
  const session = await requireSession();
  await setGoalDone(session.ctx, id, done);
  revalidatePath('/goals');
}

const editSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(160),
  dueOn: daySchema,
});

/** Returns the message to show beside the field, or null. */
export async function editGoalAction(
  id: string,
  title: string,
  dueOn: string,
): Promise<string | null> {
  const session = await requireSession();
  const t = await getTranslations('goals');

  const parsed = editSchema.safeParse({ id, title, dueOn });
  if (!parsed.success) return t('invalid');

  await editGoal(session.ctx, parsed.data.id, {
    title: parsed.data.title,
    dueOn: parsed.data.dueOn,
  });
  revalidatePath('/goals');
  return null;
}

export async function deleteGoalAction(id: string): Promise<void> {
  const session = await requireSession();
  await deleteGoal(session.ctx, id);
  revalidatePath('/goals');
}
