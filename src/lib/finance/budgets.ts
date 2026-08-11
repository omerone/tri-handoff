import type { CategoryTotal } from './balance';

/**
 * A budget measured against what was actually spent.
 *
 * The ledger answers "what did I spend"; this turns it into the two questions an allowance is
 * kept for — how much is left, and if none, by how much it was passed.
 *
 * Every figure here is in the budget's own currency, including the spending, which the ledger
 * holds in shekels. The alternative — comparing in shekels and converting for display — makes
 * the ceiling itself move: "$2,000 a month" would read as $1,935 the week the rate shifted,
 * and a limit that changes on its own is not a limit.
 */
export type BudgetUse = {
  category: string;
  /** The ceiling for the window being read, already scaled from the monthly figure. */
  budget: number;
  spent: number;
  /** What is left. Zero once the ceiling is passed — never negative; `over` says that part. */
  remaining: number;
  /** How far past the ceiling. Zero while still inside it. */
  over: number;
  /**
   * Spent over budget, uncapped, so a gauge can draw 1.4 as "forty per cent past" rather than
   * pinning at full and losing the fact. Zero-budget yields 0 rather than infinity.
   */
  ratio: number;
  /** What all of the above are denominated in. */
  currency: string;
};

/** A ceiling as it was written down: a number, and what that number counts. */
export type BudgetAmount = { category: string; amount: number; currency: string };

/**
 * How many months of allowance a window is worth.
 *
 * A budget is decided per calendar month and a screen can be showing three of them, so the
 * ceiling has to be scaled or the gauge compares a quarter's spending to one month's
 * allowance and reports a wild overrun on a perfectly normal quarter.
 *
 * Inclusive of both ends: January to March is three months, not two.
 */
export function monthsCovered(
  months: { from: { year: number; month: number }; to: { year: number; month: number } } | null,
): number | null {
  if (!months) return null;
  const span =
    (months.to.year - months.from.year) * 12 + (months.to.month - months.from.month) + 1;
  return span > 0 ? span : null;
}

/**
 * Budgets and spending, joined on the category.
 *
 * Every budget appears, including the ones nothing has been spent against — an untouched
 * allowance is the good case and hiding it would make the screen change shape every time the
 * first expense of the month is entered. Spending in a category with *no* budget is
 * deliberately not invented here: it belongs in the breakdown beside this, not as a gauge
 * against a ceiling nobody set.
 *
 * `rate` converts a shekel into one unit of the budget's currency, and returning null for one
 * drops that budget rather than measuring it at 1:1. That is the whole reason it can say no:
 * a dollar ceiling compared against unconverted shekels reports a threefold overrun on a
 * month that never happened, and it looks exactly like a real one. The caller is left to say
 * which categories went missing and why.
 *
 * Ordered by how close each one is to its limit, so whatever needs attention is read first.
 */
export function budgetUse(
  budgets: readonly BudgetAmount[],
  /** Spending per category, in shekels, as the ledger stores it. */
  spending: readonly CategoryTotal[],
  months: number,
  rate: (currency: string) => number | null,
): BudgetUse[] {
  const spentBy = new Map(spending.map((one) => [one.category, one.total]));

  return budgets
    .flatMap((budget) => {
      const toBudget = rate(budget.currency);
      if (toBudget === null) return [];

      const scaled = budget.amount * Math.max(1, months);
      const spent = (spentBy.get(budget.category) ?? 0) * toBudget;
      const over = Math.max(0, spent - scaled);

      return [
        {
          category: budget.category,
          budget: scaled,
          spent,
          remaining: Math.max(0, scaled - spent),
          over,
          ratio: scaled === 0 ? 0 : spent / scaled,
          currency: budget.currency,
        },
      ];
    })
    .sort((a, b) => b.ratio - a.ratio);
}
