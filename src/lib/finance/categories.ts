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
  // First, because this is a trading product: money moved to the broker is the expense this
  // user records most, and it was at the bottom of a twelve-item list — past every household
  // category — for no reason other than the order they were first written in.
  'tradingDeposit',
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

/**
 * The identity two categories are compared by.
 *
 * Free text is the point of this module — whatever word the person thinks in is the right
 * one — but it means "Food" and "food" are two categories to a computer and one category to
 * the person who typed both. Anywhere two sides of the app have to agree on which category
 * something belongs to, they agree on this rather than on the raw string.
 *
 * Not used for storing or displaying: the category is kept exactly as it was written, so the
 * capital letter somebody chose survives.
 */
export function categoryKey(category: string): string {
  return category.trim().toLowerCase();
}

/**
 * What to offer when somebody types a category, in the order they want to see it.
 *
 * Three sources, and the caller picks which of them apply, because the two forms on the
 * finance screen are asking different questions. The form that *spends* money offers the
 * ceilings and nothing else: a trader who has said what their categories are does not want
 * twelve more underneath them, and the list they see is the one that keeps the ledger and
 * the dials filed under the same word. The form that *creates* a ceiling offers everything,
 * because that is where a category is invented and the starting list is worth having.
 *
 * The field is free text either way. Nothing here is a restriction on what can be typed —
 * only on what is worth suggesting.
 *
 * Returned as stored — keys for the built-ins, the person's own words for the rest — so the
 * caller can translate the ones that have a translation.
 */
export function categoryVocabulary(
  type: FinanceType,
  source: {
    /** Categories with a ceiling. First, because they are what the person is managing. */
    budgeted?: readonly string[];
    /** Everything in the book, so a category used in March is still offered in August. */
    used?: readonly { type: FinanceType; category: string }[];
    /** The twelve built-ins, as a starting point for whatever has not been used yet. */
    includeSuggested?: boolean;
  },
): string[] {
  const seen = new Set<string>();
  const vocabulary: string[] = [];

  const offer = (category: string) => {
    const key = categoryKey(category);
    if (!key || seen.has(key)) return;
    seen.add(key);
    vocabulary.push(category);
  };

  source.budgeted?.forEach(offer);
  for (const entry of source.used ?? []) if (entry.type === type) offer(entry.category);
  if (source.includeSuggested) suggestedCategories(type).forEach(offer);

  return vocabulary;
}
