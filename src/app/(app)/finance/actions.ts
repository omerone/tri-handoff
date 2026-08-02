'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createFinanceEntry, deleteFinanceEntry, endRecurringSeries } from '@/lib/db';
import { isPlausibleDate, isPlausibleMonth, MIN_YEAR } from '@/lib/finance/bounds';
import { DEFAULT_CATEGORY, resolveCategoryKey } from '@/lib/finance/categories';

export type FinanceFormState = { error?: string; ok?: boolean };

/**
 * Categories are stored as keys and translated at render, but the datalist hands back
 * whatever the user sees — so a Hebrew user picking "משכורת" would otherwise store that
 * literal string. It would then render untranslated, and switching the interface to English
 * would strand every category the client had ever recorded.
 *
 * Anything that does not match a known label in the current language is kept verbatim: a
 * user's own word for a category is a legitimate answer.
 */
async function categoryKeyFor(typed: string): Promise<string> {
  const value = typed.trim();
  if (!value) return DEFAULT_CATEGORY;

  const t = await getTranslations('finance');
  return resolveCategoryKey(value, (key) => t(`categories.${key}`));
}

/**
 * Amounts are entered in shekels and stored in shekels (SPEC §3.1). `coerce` handles the
 * string a form gives us; the positivity check is what stops a "-500 income" from being a
 * second way to record an expense, which would make every category total wrong.
 */
const entrySchema = z.object({
  type: z.enum(['income', 'expense']),
  label: z.string().trim().min(1).max(120),
  amountIls: z.coerce.number().positive().finite().max(1_000_000_000),
  category: z.string().trim().max(60).default(DEFAULT_CATEGORY),
  // Bounded: an out-of-window date is a typo in every real case, and accepting one is what
  // made the month arithmetic a denial-of-service vector. See lib/finance/bounds.ts.
  entryDate: z.coerce.date().refine((date) => isPlausibleDate(date), {
    message: `The date must be between ${MIN_YEAR} and a few years from now.`,
  }),
  isRecurring: z.coerce.boolean().default(false),
});

function parse(formData: FormData) {
  return entrySchema.safeParse({
    type: formData.get('type'),
    label: formData.get('label'),
    amountIls: formData.get('amountIls'),
    category: formData.get('category') || DEFAULT_CATEGORY,
    entryDate: formData.get('entryDate'),
    // An unchecked checkbox is simply absent from the form data.
    isRecurring: formData.get('isRecurring') === 'on' || formData.get('isRecurring') === 'true',
  });
}

export async function createFinanceEntryAction(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const session = await requireSession();
  const t = await getTranslations('finance');

  const parsed = parse(formData);
  if (!parsed.success) return { error: t('invalid') };

  await createFinanceEntry(session.ctx, {
    ...parsed.data,
    category: await categoryKeyFor(parsed.data.category),
  });

  revalidatePath('/finance');
  return { ok: true };
}

/*
 * There is deliberately no "edit entry" action.
 *
 * An earlier draft had one, unreachable from any UI. Its schema had no `recurringUntil`, and
 * the repository wrote `input.recurringUntil ?? null` — so wiring it up would have silently
 * re-opened a series the user had deliberately ended, retroactively changing every month
 * after the end date. Correcting an entry is delete-and-re-add, which cannot do that.
 */
export async function deleteFinanceEntryAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteFinanceEntry(session.ctx, id);
  revalidatePath('/finance');
}

/**
 * Ends a recurring series rather than deleting it — see `endRecurringSeries`. Deleting the
 * row would rewrite every past month it appeared in.
 */
export async function endRecurringSeriesAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const id = String(formData.get('id') ?? '');
  const year = Number(formData.get('year'));
  const month = Number(formData.get('month'));
  // A month outside the window reaches Date.UTC as an Invalid Date and surfaces as a 500;
  // month 0 or 13 silently rolls into the adjacent year, ending the series a month early.
  if (!id || !isPlausibleMonth({ year, month })) return;

  await endRecurringSeries(session.ctx, id, { year, month });
  revalidatePath('/finance');
}
