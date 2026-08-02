import { describe, expect, it } from 'vitest';
import {
  cumulativeCash,
  expensesByCategory,
  monthBalance,
  totalWealth,
  yearBalance,
  type FinanceEntry,
} from './balance';
import { monthsWithActivity, occurrencesInMonth } from './recurring';

/**
 * Recurring entries are expanded on read, so a bug here does not throw — it quietly
 * misstates a month. The cases below are the ones where "obviously correct" and "actually
 * correct" diverge: month-end anchors, series boundaries, and the difference between a flow
 * and a stock.
 */

const day = (year: number, month: number, d: number) => new Date(Date.UTC(year, month - 1, d));

let counter = 0;
function entry(overrides: Partial<FinanceEntry> = {}): FinanceEntry {
  counter += 1;
  return {
    id: `e${counter}`,
    type: 'expense',
    category: 'other',
    label: `entry ${counter}`,
    amountIls: 100,
    entryDate: day(2026, 1, 15),
    isRecurring: false,
    recurringUntil: null,
    ...overrides,
  };
}

describe('one-off entries', () => {
  it('appear only in their own month', () => {
    const entries = [entry({ entryDate: day(2026, 3, 10), amountIls: 250 })];

    expect(occurrencesInMonth(entries, 2026, 3)).toHaveLength(1);
    expect(occurrencesInMonth(entries, 2026, 2)).toHaveLength(0);
    expect(occurrencesInMonth(entries, 2026, 4)).toHaveLength(0);
  });

  it('are included on the first and last day of the month', () => {
    const first = entry({ entryDate: day(2026, 2, 1) });
    const last = entry({ entryDate: day(2026, 2, 28) });
    expect(occurrencesInMonth([first, last], 2026, 2)).toHaveLength(2);
  });
});

describe('recurring entries', () => {
  const salary = entry({
    type: 'income',
    category: 'salary',
    amountIls: 18_500,
    entryDate: day(2026, 1, 1),
    isRecurring: true,
  });

  it('repeat every month from the anchor onwards', () => {
    for (const month of [1, 2, 3, 12]) {
      const found = occurrencesInMonth([salary], 2026, month);
      expect(found, `month ${month}`).toHaveLength(1);
      expect(found[0]!.amountIls).toBe(18_500);
    }
    // Into the next year, too.
    expect(occurrencesInMonth([salary], 2027, 5)).toHaveLength(1);
  });

  it('do not appear before the month they start', () => {
    expect(occurrencesInMonth([salary], 2025, 12)).toHaveLength(0);
  });

  it('stop after recurringUntil', () => {
    const ending = { ...salary, recurringUntil: day(2026, 3, 31) };
    expect(occurrencesInMonth([ending], 2026, 3)).toHaveLength(1);
    expect(occurrencesInMonth([ending], 2026, 4)).toHaveLength(0);
  });

  it('marks the anchor month as stored and later months as generated', () => {
    // The UI needs to know which instance is the real row, so "edit the series" has
    // something to point at.
    expect(occurrencesInMonth([salary], 2026, 1)[0]!.generated).toBe(false);
    expect(occurrencesInMonth([salary], 2026, 2)[0]!.generated).toBe(true);
  });

  describe('month-end anchors', () => {
    const rent = entry({ entryDate: day(2026, 1, 31), isRecurring: true, amountIls: 6_200 });

    it('clamp to the last day of a shorter month rather than skipping it', () => {
      // February has no 31st. Skipping would mean rent simply not being due that month,
      // which is not how rent works.
      const february = occurrencesInMonth([rent], 2026, 2);
      expect(february).toHaveLength(1);
      expect(february[0]!.occurrenceDate).toEqual(day(2026, 2, 28));
    });

    it('clamps to 29 February in a leap year', () => {
      const leap = occurrencesInMonth([rent], 2028, 2);
      expect(leap[0]!.occurrenceDate).toEqual(day(2028, 2, 29));
    });

    it('returns to the 31st in a month that has one', () => {
      expect(occurrencesInMonth([rent], 2026, 3)[0]!.occurrenceDate).toEqual(day(2026, 3, 31));
      expect(occurrencesInMonth([rent], 2026, 4)[0]!.occurrenceDate).toEqual(day(2026, 4, 30));
    });
  });

  it('sorts a month by occurrence date', () => {
    const entries = [
      entry({ entryDate: day(2026, 1, 20), isRecurring: true }),
      entry({ entryDate: day(2026, 1, 5), isRecurring: true }),
      entry({ entryDate: day(2026, 3, 12) }),
    ];
    const dates = occurrencesInMonth(entries, 2026, 3).map((e) => e.occurrenceDate.getUTCDate());
    expect(dates).toEqual([5, 12, 20]);
  });
});

describe('monthBalance', () => {
  const entries = [
    entry({ type: 'income', amountIls: 18_500, entryDate: day(2026, 7, 1) }),
    entry({ type: 'income', amountIls: 3_200, entryDate: day(2026, 7, 14) }),
    entry({ type: 'expense', amountIls: 6_200, entryDate: day(2026, 7, 2) }),
    entry({ type: 'expense', amountIls: 2_900, entryDate: day(2026, 7, 20) }),
  ];

  it('adds up income, expenses and net', () => {
    const balance = monthBalance(entries, 2026, 7);
    expect(balance.income).toBe(21_700);
    expect(balance.expenses).toBe(9_100);
    expect(balance.net).toBe(12_600);
  });

  it('is zero for a month with nothing in it', () => {
    const balance = monthBalance(entries, 2026, 8);
    expect(balance).toMatchObject({ income: 0, expenses: 0, net: 0 });
    expect(balance.entries).toEqual([]);
  });

  it('always satisfies net === income − expenses', () => {
    for (let month = 1; month <= 12; month++) {
      const balance = monthBalance(entries, 2026, month);
      expect(balance.net).toBe(balance.income - balance.expenses);
    }
  });

  it('counts a recurring entry in every month it covers', () => {
    const recurring = [entry({ type: 'expense', amountIls: 1_000, entryDate: day(2026, 1, 5), isRecurring: true })];
    for (let month = 1; month <= 12; month++) {
      expect(monthBalance(recurring, 2026, month).expenses).toBe(1_000);
    }
  });
});

describe('expensesByCategory', () => {
  it('groups and ranks by size', () => {
    const balance = monthBalance(
      [
        entry({ category: 'rent', amountIls: 6_200, entryDate: day(2026, 7, 2) }),
        entry({ category: 'food', amountIls: 1_500, entryDate: day(2026, 7, 5) }),
        entry({ category: 'food', amountIls: 1_400, entryDate: day(2026, 7, 20) }),
        entry({ type: 'income', category: 'salary', amountIls: 18_500, entryDate: day(2026, 7, 1) }),
      ],
      2026,
      7,
    );

    const totals = expensesByCategory(balance);
    expect(totals).toEqual([
      { category: 'rent', total: 6_200, count: 1 },
      { category: 'food', total: 2_900, count: 2 },
    ]);
    // Income is not an expense category.
    expect(totals.some((t) => t.category === 'salary')).toBe(false);
  });

  it('reconciles with the month total', () => {
    const balance = monthBalance(
      [
        entry({ category: 'rent', amountIls: 6_200, entryDate: day(2026, 7, 2) }),
        entry({ category: 'food', amountIls: 1_500, entryDate: day(2026, 7, 5) }),
      ],
      2026,
      7,
    );
    const summed = expensesByCategory(balance).reduce((sum, c) => sum + c.total, 0);
    expect(summed).toBe(balance.expenses);
  });
});

describe('yearBalance', () => {
  const entries = [
    entry({ type: 'income', amountIls: 10_000, entryDate: day(2026, 1, 1), isRecurring: true }),
    entry({ type: 'expense', amountIls: 4_000, entryDate: day(2026, 1, 5), isRecurring: true }),
  ];

  it('sums its twelve months', () => {
    const year = yearBalance(entries, 2026);

    expect(year.months).toHaveLength(12);
    expect(year.income).toBe(120_000);
    expect(year.expenses).toBe(48_000);
    expect(year.net).toBe(72_000);
    expect(year.net).toBe(year.months.reduce((sum, m) => sum + m.net, 0));
  });

  it('stops at the requested month, so "year to date" is not a projection', () => {
    // Recurring entries never end unless told to, so a full-year expansion happily runs a
    // salary through December and labels it "year to date". Bounded at March: three months.
    const ytd = yearBalance(entries, 2026, 3);
    expect(ytd.months).toHaveLength(3);
    expect(ytd.net).toBe(18_000);
  });

  it('clamps a nonsensical bound rather than returning an empty year', () => {
    expect(yearBalance(entries, 2026, 0).months).toHaveLength(1);
    expect(yearBalance(entries, 2026, 99).months).toHaveLength(12);
  });
});

describe('cumulativeCash', () => {
  /**
   * The distinction this exists to protect: net worth is a stock, a monthly net is a flow.
   * The prototype added one month's net to the trading balance and called it total wealth,
   * which would make net worth jump every time a salary landed.
   */
  it('accumulates every month from the first entry', () => {
    const entries = [
      entry({ type: 'income', amountIls: 10_000, entryDate: day(2026, 1, 1), isRecurring: true }),
      entry({ type: 'expense', amountIls: 6_000, entryDate: day(2026, 1, 5), isRecurring: true }),
    ];

    expect(cumulativeCash(entries, { year: 2026, month: 1 })).toBe(4_000);
    expect(cumulativeCash(entries, { year: 2026, month: 3 })).toBe(12_000);
    expect(cumulativeCash(entries, { year: 2026, month: 12 })).toBe(48_000);
  });

  it('differs from the monthly net, which is the whole point', () => {
    const entries = [
      entry({ type: 'income', amountIls: 10_000, entryDate: day(2026, 1, 1), isRecurring: true }),
    ];
    const march = monthBalance(entries, 2026, 3);

    expect(march.net).toBe(10_000);
    expect(cumulativeCash(entries, { year: 2026, month: 3 })).toBe(30_000);
  });

  it('spans a year boundary', () => {
    const entries = [
      entry({ type: 'income', amountIls: 1_000, entryDate: day(2026, 11, 1), isRecurring: true }),
    ];
    // Nov, Dec, Jan.
    expect(cumulativeCash(entries, { year: 2027, month: 1 })).toBe(3_000);
  });

  it('is zero with no entries', () => {
    expect(cumulativeCash([], { year: 2026, month: 7 })).toBe(0);
  });
});

describe('totalWealth', () => {
  it('adds the three components', () => {
    expect(totalWealth({ trading: 18_935, longPositions: 22_000, cash: 12_600 })).toBe(53_535);
  });

  it('handles a negative component', () => {
    // A drawn-down account and an overspent month are both entirely possible.
    expect(totalWealth({ trading: 8_000, longPositions: 0, cash: -2_000 })).toBe(6_000);
  });
});

describe('monthsWithActivity', () => {
  it('lists every month from the earliest entry to the requested one, newest first', () => {
    const entries = [entry({ entryDate: day(2026, 5, 10) })];
    const months = monthsWithActivity(entries, { year: 2026, month: 8 });

    expect(months).toHaveLength(4);
    expect(months[0]).toEqual({ year: 2026, month: 8 });
    expect(months.at(-1)).toEqual({ year: 2026, month: 5 });
  });

  it('crosses a year boundary', () => {
    const entries = [entry({ entryDate: day(2025, 11, 1) })];
    const months = monthsWithActivity(entries, { year: 2026, month: 2 });
    expect(months.map((m) => `${m.year}-${m.month}`)).toEqual([
      '2026-2',
      '2026-1',
      '2025-12',
      '2025-11',
    ]);
  });

  it('returns just the current month when there is nothing recorded', () => {
    expect(monthsWithActivity([], { year: 2026, month: 7 })).toEqual([{ year: 2026, month: 7 }]);
  });
});
