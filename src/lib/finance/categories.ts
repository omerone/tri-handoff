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
 * The suggestions were the twelve built-ins and nothing else, so a category the person had
 * invented — and set a budget against — was missing from the list on the one form that files
 * money into it. Retyping it by hand is where the two sides drift apart: an expense under
 * "בזבוזים " with a trailing space is money the dial for "בזבוזים" will never see.
 *
 * Budgeted categories lead, because those are the ones with a ceiling being watched and the
 * ones a person is most likely to be filing against. Then everything else already in the
 * book, then the built-ins as a starting point for whatever has not been used yet.
 *
 * Returned as stored — keys for the built-ins, the person's own words for the rest — so the
 * caller can translate the ones that have a translation.
 */
export function categoryVocabulary(
  type: FinanceType,
  /** Everything in the book, so a category used in March is still offered in August. */
  used: readonly { type: FinanceType; category: string }[],
  /** Categories worth offering whether or not they have been spent against yet. */
  budgeted: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const vocabulary: string[] = [];

  const offer = (category: string) => {
    const key = categoryKey(category);
    if (!key || seen.has(key)) return;
    seen.add(key);
    vocabulary.push(category);
  };

  budgeted.forEach(offer);
  for (const entry of used) if (entry.type === type) offer(entry.category);
  suggestedCategories(type).forEach(offer);

  return vocabulary;
}
