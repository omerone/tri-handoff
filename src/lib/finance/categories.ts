/**
 * Suggested categories.
 *
 * SPEC §3.1 leaves "predefined or free-form" open (🔶). Both: these are offered as a
 * datalist so the common cases are one keystroke, and anything typed is accepted. A fixed
 * list would be wrong for a product with one user per tenant — whatever categories that one
 * person thinks in are the right ones — and no list at all means "Food", "food" and
 * "Groceries" become three categories by the third month.
 *
 * Keys, not labels: they are translated at render.
 */
export const INCOME_CATEGORIES = [
  'salary',
  'bonus',
  'sideProject',
  'investment',
  'refund',
  'other',
] as const;

export const EXPENSE_CATEGORIES = [
  'rent',
  'mortgage',
  'food',
  'transport',
  'utilities',
  'insurance',
  'health',
  'education',
  'leisure',
  'shopping',
  'tradingDeposit',
  'other',
] as const;

export type FinanceType = 'income' | 'expense';

export function suggestedCategories(type: FinanceType): readonly string[] {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

const KNOWN = new Set<string>([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]);

/** True for a category with a translation; anything else is the user's own word. */
export function isKnownCategory(category: string): boolean {
  return KNOWN.has(category);
}

export const DEFAULT_CATEGORY = 'other';
