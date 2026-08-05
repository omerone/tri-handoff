'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createFinanceEntry, deleteFinanceEntry, endRecurringSeries } from '@/lib/db';
import { isPlausibleDate, isPlausibleMonth, MIN_YEAR } from '@/lib/finance/bounds';
import { DEFAULT_CATEGORY, resolveCategoryKey } from '@/lib/finance/categories';
import { setRangeCookie } from '@/lib/preferences/cookies';
import { parseIsoDate } from '@/lib/time/format';
import { formatRange, RANGE_PARAM, type TimeRange } from '@/lib/time/range';
import { wallClock } from '@/lib/time/zone';

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

  /*
   * An entry dated outside the window that is open would be saved and then not appear, which
   * reads exactly like a failure. The date field deliberately accepts any month — recording
   * next month's rent while paying this month's is the ordinary case — so the screen follows
   * the entry rather than the entry disappearing from the screen.
   *
   * Only when it actually falls outside. Adding to the month already open, or anywhere inside
   * a wider range that was chosen on purpose, leaves the view alone.
   */
  const target = monthOutsideWindow(formData, parsed.data.entryDate);
  if (target) {
    const range: TimeRange = { kind: 'months', from: target, to: target };
    await setRangeCookie(range);
    redirect(`/finance?${RANGE_PARAM}=${formatRange(range)}`);
  }

  return { ok: true };
}

/**
 * The month to jump to, or null to stay put. Returns null when the posted window is missing
 * or unparseable, because a redirect is the more disruptive guess of the two.
 */
function monthOutsideWindow(
  formData: FormData,
  entryDate: Date,
): { year: number; month: number } | null {
  const from = parseIsoDate(String(formData.get('windowFrom') ?? ''));
  const to = parseIsoDate(String(formData.get('windowTo') ?? ''));
  if (!from || !to) return null;

  const at = wallClock(entryDate);
  const day = (parts: { year: number; month: number; day: number }) =>
    parts.year * 10000 + parts.month * 100 + parts.day;

  const inside = day(at) >= day(from) && day(at) <= day(to);
  return inside ? null : { year: at.year, month: at.month };
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
