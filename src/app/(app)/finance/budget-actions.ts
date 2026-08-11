'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { deleteBudget, setBudget } from '@/lib/db';
import { isBrother } from '@/lib/household';

export type BudgetFormState = { error?: string };

const budgetSchema = z.object({
  /*
   * The owner comes from the form rather than from the cookie, and is validated against the
   * two names — the same rule the finance and learning actions apply. A budget written
   * against a brother who does not exist is a row no screen would ever draw again, which is
   * worse than an error because it cannot be corrected from the interface.
   */
  owner: z.string().refine(isBrother),
  category: z.string().trim().min(1).max(60),
  /*
   * Text, then a number. The field is text so a comma decimal typed on a Hebrew keyboard
   * still parses, exactly as the amount field on the ledger beside it does.
   */
  amount: z
    .string()
    .transform((value) => Number(value.replace(',', '.')))
    .refine((value) => Number.isFinite(value) && value > 0 && value <= 10_000_000),
});

/** Sets a monthly ceiling, or moves one that is already set. */
export async function setBudgetAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const session = await requireSession();
  const t = await getTranslations('finance');

  const parsed = budgetSchema.safeParse({
    owner: formData.get('owner') ?? '',
    category: formData.get('category') ?? '',
    amount: String(formData.get('amount') ?? ''),
  });
  if (!parsed.success) return { error: t('invalid') };

  await setBudget(session.ctx, {
    owner: parsed.data.owner,
    category: parsed.data.category,
    amountIls: parsed.data.amount,
  });

  revalidatePath('/finance');
  return {};
}

export async function deleteBudgetAction(id: string): Promise<void> {
  const session = await requireSession();
  await deleteBudget(session.ctx, id);
  revalidatePath('/finance');
}
