import { describe, expect, it } from 'vitest';
import { budgetUse, monthsCovered } from './budgets';

const spent = (category: string, total: number) => ({ category, total, count: 1 });

/** A shekel budget: no conversion, so the arithmetic is the ledger's own numbers. */
const shekels = (category: string, amount: number) => ({ category, amount, currency: 'ILS' });

/** Rates into each currency, from one shekel. Roughly today's, rounded for readability. */
const RATES: Record<string, number> = { ILS: 1, USD: 1 / 3, EUR: 1 / 4 };
const rate = (currency: string) => RATES[currency] ?? null;

describe('budget use', () => {
  it('reports what is left while inside the ceiling', () => {
    // The example the feature was asked for: 2,000 set, 200 spent, 1,800 left.
    const [use] = budgetUse([shekels('spending', 2000)], [spent('spending', 200)], 1, rate);
    expect(use).toMatchObject({ budget: 2000, spent: 200, remaining: 1800, over: 0 });
    expect(use!.ratio).toBeCloseTo(0.1);
  });

  it('reports the overrun once the ceiling is passed', () => {
    const [use] = budgetUse([shekels('spending', 2000)], [spent('spending', 2350)], 1, rate);
    // Never a negative "remaining": the two facts are separate, and one of them is zero.
    expect(use).toMatchObject({ remaining: 0, over: 350 });
    expect(use!.ratio).toBeCloseTo(1.175);
  });

  it('keeps a budget nothing has been spent against', () => {
    // An untouched allowance is the good case; hiding it would make the card change shape the
    // moment the first expense of the month is entered.
    const [use] = budgetUse([shekels('food', 800)], [], 1, rate);
    expect(use).toMatchObject({ spent: 0, remaining: 800, over: 0 });
  });

  it('does not invent a gauge for spending with no budget', () => {
    expect(budgetUse([], [spent('food', 500)], 1, rate)).toHaveLength(0);
  });

  /*
   * The scaling, which is the part that would silently mislead.
   *
   * A budget is decided per month and the screen can be showing three of them. Comparing a
   * quarter's spending to one month's allowance reports a wild overrun on a perfectly normal
   * quarter — so the ceiling is scaled, not the spending.
   */
  it('scales the ceiling to the months on screen', () => {
    const [use] = budgetUse([shekels('food', 800)], [spent('food', 2000)], 3, rate);
    expect(use).toMatchObject({ budget: 2400, spent: 2000, remaining: 400, over: 0 });
  });

  it('puts whatever is closest to its limit first', () => {
    const use = budgetUse(
      [shekels('calm', 1000), shekels('tight', 1000)],
      [spent('calm', 100), spent('tight', 1200)],
      1,
      rate,
    );
    expect(use.map((one) => one.category)).toEqual(['tight', 'calm']);
  });

  it('does not divide by a ceiling of zero', () => {
    const [use] = budgetUse([shekels('food', 0)], [spent('food', 50)], 1, rate);
    expect(use!.ratio).toBe(0);
    expect(Number.isFinite(use!.ratio)).toBe(true);
  });
});

describe('a budget kept in another currency', () => {
  it('brings the shekel spending up to the ceiling rather than the other way round', () => {
    // $500 a month, ₪900 spent. At three shekels to the dollar that is $300 of it — so $200
    // is left, and every figure on the tile is in dollars because the ceiling is.
    const [use] = budgetUse(
      [{ category: 'food', amount: 500, currency: 'USD' }],
      [spent('food', 900)],
      1,
      rate,
    );
    expect(use).toMatchObject({ budget: 500, spent: 300, remaining: 200, over: 0 });
    expect(use!.currency).toBe('USD');
  });

  it('reports the overrun in the ceiling’s currency too', () => {
    const [use] = budgetUse(
      [{ category: 'food', amount: 100, currency: 'USD' }],
      [spent('food', 900)],
      1,
      rate,
    );
    expect(use).toMatchObject({ spent: 300, remaining: 0, over: 200 });
  });

  it('leaves the shekel budgets beside it untouched', () => {
    // The rate applies to the budget that asked for it, not to the screen.
    const use = budgetUse(
      [
        { category: 'food', amount: 300, currency: 'USD' },
        shekels('fuel', 300),
      ],
      [spent('food', 300), spent('fuel', 300)],
      1,
      rate,
    );
    expect(use.find((one) => one.category === 'food')!.spent).toBe(100);
    expect(use.find((one) => one.category === 'fuel')!.spent).toBe(300);
  });

  /*
   * The one that matters most, and the reason the rate is allowed to say no.
   *
   * Measuring a dollar ceiling against unconverted shekels reports a threefold overrun on a
   * month that never happened, and it looks exactly like a real one. Dropping the budget is
   * recoverable — the screen says which ones went and why. A confident wrong dial is not.
   */
  it('is dropped, not measured at par, when there is no rate for it', () => {
    const use = budgetUse(
      [
        { category: 'food', amount: 500, currency: 'GBP' },
        shekels('fuel', 300),
      ],
      [spent('food', 900), spent('fuel', 100)],
      1,
      rate,
    );
    expect(use.map((one) => one.category)).toEqual(['fuel']);
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

describe('the join between a ceiling and the money', () => {
  const rate = () => 1;

  /*
   * The failure this guards is the quiet one. A budget on "Food" while the expenses are
   * filed under "food" is a dial that reads zero forever — not an error, not a blank, a
   * confident and wrong number that says the allowance is untouched.
   */
  it('does not care how the category was capitalised', () => {
    const [use] = budgetUse(
      [{ category: 'Food', amount: 1000, currency: 'ILS' }],
      [{ category: 'food', total: 250, count: 1 }],
      1,
      rate,
    );
    expect(use!.spent).toBe(250);
  });

  it('ignores a space left on the end of one of them', () => {
    const [use] = budgetUse(
      [{ category: 'בזבוזים', amount: 1000, currency: 'ILS' }],
      [{ category: 'בזבוזים ', total: 200, count: 1 }],
      1,
      rate,
    );
    expect(use!.spent).toBe(200);
  });

  it('adds up two spellings of one category rather than taking the last', () => {
    // Both are the same category to whoever typed them, so both come off the same ceiling.
    const [use] = budgetUse(
      [{ category: 'food', amount: 1000, currency: 'ILS' }],
      [
        { category: 'Food', total: 300, count: 1 },
        { category: 'food', total: 200, count: 1 },
      ],
      1,
      rate,
    );
    expect(use!.spent).toBe(500);
    expect(use!.remaining).toBe(500);
  });
});
