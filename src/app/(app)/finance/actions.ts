'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import {
  createFinanceEntry,
  deleteFinanceEntry,
  endRecurringSeries,
  updateFinanceEntry,
} from '@/lib/db';
import { DEFAULT_CATEGORY } from '@/lib/finance/categories';

export type FinanceFormState = { error?: string; ok?: boolean };

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
  entryDate: z.coerce.date(),
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
    category: parsed.data.category || DEFAULT_CATEGORY,
  });

  revalidatePath('/finance');
  return { ok: true };
}

export async function updateFinanceEntryAction(
  _prev: FinanceFormState,
  formData: FormData,
): Promise<FinanceFormState> {
  const session = await requireSession();
  const t = await getTranslations('finance');

  const id = String(formData.get('id') ?? '');
  const parsed = parse(formData);
  if (!id || !parsed.success) return { error: t('invalid') };

  await updateFinanceEntry(session.ctx, id, {
    ...parsed.data,
    category: parsed.data.category || DEFAULT_CATEGORY,
  });

  revalidatePath('/finance');
  return { ok: true };
}

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
  if (!id || !Number.isInteger(year) || !Number.isInteger(month)) return;

  await endRecurringSeries(session.ctx, id, { year, month });
  revalidatePath('/finance');
}
