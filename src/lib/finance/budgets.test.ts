import { describe, expect, it } from 'vitest';
import { budgetUse, monthsCovered } from './budgets';

const spent = (category: string, total: number) => ({ category, total, count: 1 });

describe('budget use', () => {
  it('reports what is left while inside the ceiling', () => {
    // The example the feature was asked for: 2,000 set, 200 spent, 1,800 left.
    const [use] = budgetUse([{ category: 'spending', amountIls: 2000 }], [spent('spending', 200)], 1);
    expect(use).toMatchObject({ budget: 2000, spent: 200, remaining: 1800, over: 0 });
    expect(use!.ratio).toBeCloseTo(0.1);
  });

  it('reports the overrun once the ceiling is passed', () => {
    const [use] = budgetUse([{ category: 'spending', amountIls: 2000 }], [spent('spending', 2350)], 1);
    // Never a negative "remaining": the two facts are separate, and one of them is zero.
    expect(use).toMatchObject({ remaining: 0, over: 350 });
    expect(use!.ratio).toBeCloseTo(1.175);
  });

  it('keeps a budget nothing has been spent against', () => {
    // An untouched allowance is the good case; hiding it would make the card change shape the
    // moment the first expense of the month is entered.
    const [use] = budgetUse([{ category: 'food', amountIls: 800 }], [], 1);
    expect(use).toMatchObject({ spent: 0, remaining: 800, over: 0 });
  });

  it('does not invent a gauge for spending with no budget', () => {
    expect(budgetUse([], [spent('food', 500)], 1)).toHaveLength(0);
  });

  /*
   * The scaling, which is the part that would silently mislead.
   *
   * A budget is decided per month and the screen can be showing three of them. Comparing a
   * quarter's spending to one month's allowance reports a wild overrun on a perfectly normal
   * quarter — so the ceiling is scaled, not the spending.
   */
  it('scales the ceiling to the months on screen', () => {
    const [use] = budgetUse([{ category: 'food', amountIls: 800 }], [spent('food', 2000)], 3);
    expect(use).toMatchObject({ budget: 2400, spent: 2000, remaining: 400, over: 0 });
  });

  it('puts whatever is closest to its limit first', () => {
    const use = budgetUse(
      [
        { category: 'calm', amountIls: 1000 },
        { category: 'tight', amountIls: 1000 },
      ],
      [spent('calm', 100), spent('tight', 1200)],
      1,
    );
    expect(use.map((one) => one.category)).toEqual(['tight', 'calm']);
  });

  it('does not divide by a ceiling of zero', () => {
    const [use] = budgetUse([{ category: 'food', amountIls: 0 }], [spent('food', 50)], 1);
    expect(use!.ratio).toBe(0);
    expect(Number.isFinite(use!.ratio)).toBe(true);
  });
});

describe('months covered', () => {
  it('counts both ends', () => {
    // January to March is three months of allowance, not two.
    expect(monthsCovered({ from: { year: 2026, month: 1 }, to: { year: 2026, month: 3 } })).toBe(3);
    expect(monthsCovered({ from: { year: 2026, month: 8 }, to: { year: 2026, month: 8 } })).toBe(1);
  });

  it('crosses a year boundary', () => {
    expect(monthsCovered({ from: { year: 2025, month: 11 }, to: { year: 2026, month: 2 } })).toBe(4);
  });

  it('has no answer for an unbounded window', () => {
    // "All time" against a monthly figure is not a number that means anything.
    expect(monthsCovered(null)).toBeNull();
  });
});
