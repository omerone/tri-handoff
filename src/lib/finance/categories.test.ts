import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import he from '../../messages/he.json';
import {
  DEFAULT_CATEGORY,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  categoryKey,
  categoryVocabulary,
  isKnownCategory,
  resolveCategoryKey,
  suggestedCategories,
} from './categories';

/**
 * Categories are stored as keys and translated at render. The datalist, however, puts the
 * *label* into the input — that is what a datalist does — so without a mapping back, a Hebrew
 * user picking "משכורת" stored that literal string. It then rendered untranslated, and
 * switching the interface to English stranded every category the client had ever recorded.
 */

const enLabel = (key: string) => (en.finance.categories as Record<string, string>)[key]!;
const heLabel = (key: string) => (he.finance.categories as Record<string, string>)[key]!;

describe('resolveCategoryKey', () => {
  it('maps an English label back to its key', () => {
    expect(resolveCategoryKey('Salary', enLabel)).toBe('salary');
    expect(resolveCategoryKey('Deposit to trading', enLabel)).toBe('tradingDeposit');
  });

  it('maps a Hebrew label back to the same key', () => {
    // The point of keys: the same category recorded in either language is one category.
    expect(resolveCategoryKey('משכורת', heLabel)).toBe('salary');
    expect(resolveCategoryKey('הפקדה לחשבון מסחר', heLabel)).toBe('tradingDeposit');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveCategoryKey('  sALArY ', enLabel)).toBe('salary');
  });

  it('passes a key straight through', () => {
    // Whatever the UI hands over, a key that is already a key must not be re-mapped.
    expect(resolveCategoryKey('salary', enLabel)).toBe('salary');
  });

  it("keeps a word the user invented, since SPEC §3.1 leaves categories open", () => {
    expect(resolveCategoryKey('Sourdough', enLabel)).toBe('Sourdough');
    expect(resolveCategoryKey('חתול', heLabel)).toBe('חתול');
  });

  it('falls back to the default for an empty value', () => {
    expect(resolveCategoryKey('', enLabel)).toBe(DEFAULT_CATEGORY);
    expect(resolveCategoryKey('   ', enLabel)).toBe(DEFAULT_CATEGORY);
  });
});

describe('the suggestion lists', () => {
  it('offers income and expense categories separately', () => {
    expect(suggestedCategories('income')).toEqual(INCOME_CATEGORIES);
    expect(suggestedCategories('expense')).toEqual(EXPENSE_CATEGORIES);
  });

  it('has a translation for every suggested key in both languages', () => {
    // A missing one renders as a dotted message key in the datalist.
    for (const key of [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]) {
      expect(enLabel(key), `en.${key}`).toBeTruthy();
      expect(heLabel(key), `he.${key}`).toBeTruthy();
    }
  });

  it('recognises every suggested key', () => {
    for (const key of [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]) {
      expect(isKnownCategory(key)).toBe(true);
    }
    expect(isKnownCategory('Sourdough')).toBe(false);
  });

  it('has no two categories sharing a label in either language', () => {
    // Two keys with one label would make the reverse mapping ambiguous.
    const keys = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];
    for (const label of [enLabel, heLabel]) {
      const labels = keys.map((key) => label(key).toLowerCase());
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe('what the category field offers', () => {
  const entry = (type: 'income' | 'expense', category: string) => ({ type, category });

  it('is the ceilings, and only those, once there are any', () => {
    // Twelve built-ins under the two categories a person actually keeps is a list you scroll
    // past, and every one of them files money somewhere no dial is watching.
    const offered = categoryVocabulary('expense', { budgeted: ['בזבוזים'] });
    expect(offered).toEqual(['בזבוזים']);
  });

  it('offers the starting list when asked for it', () => {
    const offered = categoryVocabulary('expense', { includeSuggested: true });
    expect(offered).toContain('rent');
  });

  it('leads with the ceilings when both are asked for', () => {
    const offered = categoryVocabulary('expense', {
      budgeted: ['בזבוזים'],
      used: [entry('expense', 'ציוד')],
      includeSuggested: true,
    });
    expect(offered[0]).toBe('בזבוזים');
    expect(offered).toContain('ציוד');
    expect(offered).toContain('rent');
  });

  it('offers what the book already contains, whatever month it was used in', () => {
    const offered = categoryVocabulary('expense', { used: [entry('expense', 'ציוד')] });
    expect(offered).toContain('ציוד');
  });

  it('keeps income and expense apart', () => {
    const used = [entry('income', 'freelance'), entry('expense', 'ציוד')];
    expect(categoryVocabulary('income', { used })).toContain('freelance');
    expect(categoryVocabulary('income', { used })).not.toContain('ציוד');
    expect(categoryVocabulary('expense', { used })).not.toContain('freelance');
  });

  it('does not offer the same category twice in two spellings', () => {
    // Offering both is how the second one gets picked and the ledger ends up holding two.
    const offered = categoryVocabulary('expense', {
      budgeted: ['food '],
      used: [entry('expense', 'Food')],
    });
    expect(offered.filter((one) => categoryKey(one) === 'food')).toHaveLength(1);
  });

  it('offers each built-in once even when it has been used', () => {
    const offered = categoryVocabulary('expense', {
      budgeted: ['rent'],
      used: [entry('expense', 'rent')],
      includeSuggested: true,
    });
    expect(offered.filter((one) => one === 'rent')).toHaveLength(1);
  });
});

describe('the identity two categories are compared by', () => {
  it('ignores case and the space somebody left on the end', () => {
    expect(categoryKey(' Food ')).toBe(categoryKey('food'));
  });

  it('is not what gets stored', () => {
    // The capital letter someone chose is theirs; folding is only for deciding sameness.
    const offered = categoryVocabulary('expense', { used: [{ type: 'expense', category: 'Food' }] });
    expect(offered).toContain('Food');
  });
});
