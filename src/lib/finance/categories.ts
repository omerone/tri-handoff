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
const ALL_CATEGORIES = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];

/** True for a category with a translation; anything else is the user's own word. */
export function isKnownCategory(category: string): boolean {
  return KNOWN.has(category);
}

/**
 * Turns whatever the user typed back into a key, when it matches a suggestion.
 *
 * The datalist puts the *translated label* into the input — that is what a datalist does —
 * so without this a Hebrew user selecting "משכורת" stores that string rather than `salary`.
 * It would render untranslated, and switching the interface to English would strand every
 * category the client had ever recorded.
 *
 * Anything unrecognised is returned unchanged: a user's own word for a category is a
 * legitimate answer, and SPEC §3.1 leaves the choice open deliberately.
 */
export function resolveCategoryKey(typed: string, label: (key: string) => string): string {
  const value = typed.trim();
  if (!value) return DEFAULT_CATEGORY;
  if (isKnownCategory(value)) return value;

  const match = ALL_CATEGORIES.find(
    (key) => label(key).trim().toLowerCase() === value.toLowerCase(),
  );
  return match ?? value;
}

export const DEFAULT_CATEGORY = 'other';
