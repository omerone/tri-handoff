'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { deleteBudget, setBudget, setBudgetAmount } from '@/lib/db';
import { isMember } from '@/lib/household';
import { isSupportedCurrency } from '@/lib/money/currency';
import { resolveCategoryKey } from '@/lib/finance/categories';

export type BudgetFormState = { error?: string };

/*
 * Text, then a number. The field is text so a comma decimal typed on a Hebrew keyboard still
 * parses, exactly as the amount field on the ledger beside it does.
 */
const amountSchema = z
  .string()
  .transform((value) => Number(value.replace(',', '.')))
  .refine((value) => Number.isFinite(value) && value > 0 && value <= 10_000_000);

const budgetSchema = z.object({
  /*
   * The owner comes from the form rather than from the cookie, and is validated against the
   * two names — the same rule the finance and learning actions apply. A budget written
   * against a brother who does not exist is a row no screen would ever draw again, which is
   * worse than an error because it cannot be corrected from the interface.
   */
  category: z.string().trim().min(1).max(60),
  amount: amountSchema,
  /*
   * Checked against the list rather than stored as typed: an unrecognised code would print
   * no symbol and convert at no rate, which is a figure with nothing saying what it counts.
   */
  currency: z.string().refine(isSupportedCurrency),
});

/** Sets a monthly ceiling, or moves one that is already set. */
export async function setBudgetAction(
  _prev: BudgetFormState,
  formData: FormData,
): Promise<BudgetFormState> {
  const session = await requireSession();
  const t = await getTranslations('finance');

  const parsed = budgetSchema.safeParse({
    category: formData.get('category') ?? '',
    amount: String(formData.get('amount') ?? ''),
    currency: formData.get('currency') ?? '',
  });
  if (!parsed.success) return { error: t('invalid') };

  // Resolved in the body against the household of this tenant — see finance/actions.ts.
  const owner =
    session.tenant.household.length === 0
      ? null
      : isMember(session.tenant.household, formData.get('owner'))
        ? (formData.get('owner') as string)
        : false;
  if (owner === false) return { error: t('invalid') };

  await setBudget(session.ctx, {
    owner,
    /*
     * Back to a key, exactly as the ledger does with the same word.
     *
     * The list offers translated labels, so a Hebrew reader picking "תחבורה" hands back that
     * string while the expenses filed under it are stored as `transport`. Left unresolved,
     * the ceiling and the money never meet and the dial reads a confident zero forever —
     * the one failure on this screen that looks exactly like a correct answer.
     */
    category: resolveCategoryKey(parsed.data.category, (key) => t(`categories.${key}`)),
    amount: parsed.data.amount,
    currency: parsed.data.currency,
  });

  revalidatePath('/finance');
  return {};
}

/**
 * Changes a ceiling already on screen.
 *
 * Takes the row's id rather than its category, so editing "Food" can only ever move the Food
 * ceiling — there is no path here that creates a second one. Returns the message to show
 * beside the field, or null; the editor stays open on a refusal so the figure is not lost.
 */
export async function editBudgetAction(id: string, amount: string): Promise<string | null> {
  const session = await requireSession();
  const t = await getTranslations('finance');

  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) return t('invalid');

  await setBudgetAmount(session.ctx, id, parsed.data);
  revalidatePath('/finance');
  return null;
}

export async function deleteBudgetAction(id: string): Promise<void> {
  const session = await requireSession();
  await deleteBudget(session.ctx, id);
  revalidatePath('/finance');
}
