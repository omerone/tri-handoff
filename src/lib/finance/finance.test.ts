import { describe, expect, it } from 'vitest';
import {
  cumulativeCash,
  expensesByCategory,
  monthBalance,
  rangeBalance,
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

/**
 * The corners of the expansion that a reasonable reading gets wrong.
 *
 * Each of these has two plausible answers and no error in either direction — the wrong one
 * just produces a month that quietly does not add up.
 */
describe('series boundaries', () => {
  it('treats recurringUntil as the last month, not the last day', () => {
    // `endRecurringSeries` writes the last day of a month, but nothing stops a mid-month date
    // getting in. The comparison is against the start of the month, so a series ending on the
    // 15th still pays on the 20th that month — which is the intent: a series ends at the end
    // of a month, and the alternative (dropping the last occurrence) would silently delete a
    // salary the user was paid.
    const salary = entry({
      type: 'income',
      amountIls: 12_000,
      entryDate: day(2026, 1, 20),
      isRecurring: true,
      recurringUntil: day(2026, 3, 15),
    });

    const march = occurrencesInMonth([salary], 2026, 3);
    expect(march).toHaveLength(1);
    expect(march[0]!.occurrenceDate).toEqual(day(2026, 3, 20));
    expect(monthBalance([salary], 2026, 3).income).toBe(12_000);

    // …and the month after the bound is empty.
    expect(occurrencesInMonth([salary], 2026, 4)).toHaveLength(0);
  });

  it('does not start a series in the month before its anchor, even mid-month', () => {
    const entries = [entry({ entryDate: day(2026, 2, 15), isRecurring: true })];
    expect(occurrencesInMonth(entries, 2026, 1)).toHaveLength(0);
    expect(occurrencesInMonth(entries, 2026, 2)).toHaveLength(1);
  });
});

describe('a series anchored on 29 February', () => {
  // The one anchor day that exists in some years and not others. Clamping is the same rule
  // as the 31st, but 29 February is the case where a leap-year-blind implementation looks
  // correct for three years and then loses a month.
  const leapDay = entry({ entryDate: day(2028, 2, 29), isRecurring: true, amountIls: 900 });

  it('falls back to the 28th in a non-leap February', () => {
    const february = occurrencesInMonth([leapDay], 2029, 2);
    expect(february).toHaveLength(1);
    expect(february[0]!.occurrenceDate).toEqual(day(2029, 2, 28));
  });

  it('returns to the 29th in the next leap year', () => {
    expect(occurrencesInMonth([leapDay], 2032, 2)[0]!.occurrenceDate).toEqual(day(2032, 2, 29));
  });

  it('keeps the 29th in every month long enough to have one', () => {
    expect(occurrencesInMonth([leapDay], 2028, 3)[0]!.occurrenceDate).toEqual(day(2028, 3, 29));
    expect(occurrencesInMonth([leapDay], 2029, 1)[0]!.occurrenceDate).toEqual(day(2029, 1, 29));
  });

  it('is charged in every month, leap year or not', () => {
    for (const [year, month] of [
      [2028, 2],
      [2029, 2],
      [2030, 2],
      [2031, 2],
    ] as const) {
      expect(monthBalance([leapDay], year, month).expenses, `${year}-${month}`).toBe(900);
    }
  });
});

describe('a generated occurrence and a one-off on the same day', () => {
  const series = entry({
    id: 'series',
    type: 'income',
    amountIls: 1_000,
    entryDate: day(2026, 1, 5),
    isRecurring: true,
  });
  const oneOff = entry({ id: 'oneoff', amountIls: 250, entryDate: day(2026, 3, 5) });

  it('keeps both — neither collides with nor replaces the other', () => {
    const march = occurrencesInMonth([series, oneOff], 2026, 3);

    expect(march).toHaveLength(2);
    expect(march.map((o) => o.id).sort()).toEqual(['oneoff', 'series']);
    expect(monthBalance([series, oneOff], 2026, 3)).toMatchObject({
      income: 1_000,
      expenses: 250,
      net: 750,
    });
  });

  it('gives them distinct React keys', () => {
    // The list is keyed on `id:occurrenceDate`, so two rows on one day sharing a key would
    // make React drop one of them from the DOM while the totals still counted it.
    const keys = occurrencesInMonth([series, oneOff], 2026, 3).map(
      (o) => `${o.id}:${o.occurrenceDate.toISOString()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('orders same-day entries by the order they were read in', () => {
    // The sort compares occurrence dates only, and a same-day tie therefore falls back to the
    // repository's `entryDate asc`. That is deterministic, which is what the screen needs —
    // rows that swap places between two renders of the same month look like a bug.
    expect(occurrencesInMonth([series, oneOff], 2026, 3).map((o) => o.id)).toEqual([
      'series',
      'oneoff',
    ]);
    expect(occurrencesInMonth([oneOff, series], 2026, 3).map((o) => o.id)).toEqual([
      'oneoff',
      'series',
    ]);
  });
});

describe('cumulativeCash over a long history', () => {
  it('terminates on a series anchored decades ago, and counts every month of it', () => {
    // The loop walks month by month from the earliest entry. An entry backdated thirty years
    // — a typo in the date field is enough — must still return, and return the right figure
    // rather than stopping at some horizon.
    const entries = [
      entry({ type: 'income', amountIls: 100, entryDate: day(1995, 6, 1), isRecurring: true }),
    ];

    // June 1995 through August 2026 inclusive: 375 months.
    expect(cumulativeCash(entries, { year: 2026, month: 8 })).toBe(37_500);
  });

  it('counts a one-off from decades ago exactly once', () => {
    const entries = [entry({ type: 'income', amountIls: 5_000, entryDate: day(1999, 3, 3) })];
    expect(cumulativeCash(entries, { year: 2026, month: 8 })).toBe(5_000);
  });

  it('is zero for a month before anything was recorded', () => {
    // Browsing back past the first entry: nothing has been recorded yet, so there is no cash.
    const entries = [
      entry({ type: 'income', amountIls: 100, entryDate: day(2026, 6, 1), isRecurring: true }),
    ];
    expect(cumulativeCash(entries, { year: 2026, month: 5 })).toBe(0);
    expect(cumulativeCash(entries, { year: 2025, month: 12 })).toBe(0);
  });
});

/**
 * A window that is not a calendar month.
 *
 * The month view is the special case of this, and the two have to agree — a range covering
 * exactly March must report what March reports, or the same money reads differently depending
 * on which control the user reached for.
 */
describe('an arbitrary window', () => {
  const salary = entry({
    type: 'income',
    category: 'salary',
    amountIls: 10_000,
    entryDate: day(2026, 1, 1),
    isRecurring: true,
  });
  const rent = entry({
    type: 'expense',
    category: 'housing',
    amountIls: 4_000,
    entryDate: day(2026, 1, 20),
    isRecurring: true,
  });

  it('agrees with the month view over exactly one month', () => {
    const entries = [salary, rent, entry({ entryDate: day(2026, 3, 7), amountIls: 300 })];

    const asRange = rangeBalance(
      entries,
      { year: 2026, month: 3, day: 1 },
      { year: 2026, month: 3, day: 31 },
    );
    const asMonth = monthBalance(entries, 2026, 3);

    expect(asRange.income).toBe(asMonth.income);
    expect(asRange.expenses).toBe(asMonth.expenses);
    expect(asRange.net).toBe(asMonth.net);
    expect(asRange.entries).toHaveLength(asMonth.entries.length);
  });

  it('sums a multi-month window', () => {
    const quarter = rangeBalance(
      [salary, rent],
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 3, day: 31 },
    );

    expect(quarter.income).toBe(30_000);
    expect(quarter.expenses).toBe(12_000);
    expect(quarter.net).toBe(18_000);
    expect(quarter.entries).toHaveLength(6);
  });

  it('excludes an occurrence that falls outside the days asked for', () => {
    // The second half of February only: the rent on the 20th is in, the salary on the 1st is
    // not. A month-at-a-time expansion that forgot to filter would include both.
    const window = rangeBalance(
      [salary, rent],
      { year: 2026, month: 2, day: 15 },
      { year: 2026, month: 2, day: 28 },
    );

    expect(window.income).toBe(0);
    expect(window.expenses).toBe(4_000);
    expect(window.entries).toHaveLength(1);
  });

  it("picks up the next month's occurrences when the window runs into it", () => {
    // Mid-February to the 5th of March: February's rent and March's salary, and neither of
    // the two that sit outside those days.
    const window = rangeBalance(
      [salary, rent],
      { year: 2026, month: 2, day: 15 },
      { year: 2026, month: 3, day: 5 },
    );

    expect(window.income).toBe(10_000);
    expect(window.expenses).toBe(4_000);
    expect(window.entries).toHaveLength(2);
  });

  it('includes both boundary days', () => {
    const window = rangeBalance(
      [rent],
      { year: 2026, month: 2, day: 20 },
      { year: 2026, month: 3, day: 20 },
    );
    expect(window.entries).toHaveLength(2);
  });

  it('returns the entries in date order across months', () => {
    const window = rangeBalance(
      [rent, salary],
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 2, day: 28 },
    );

    const dates = window.entries.map((occurrence) => occurrence.occurrenceDate.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it('is empty for a window with nothing in it', () => {
    const window = rangeBalance(
      [entry({ entryDate: day(2026, 5, 5) })],
      { year: 2026, month: 6, day: 1 },
      { year: 2026, month: 6, day: 30 },
    );
    expect(window).toMatchObject({ income: 0, expenses: 0, net: 0, entries: [] });
  });

  it('breaks a window down by category, largest first', () => {
    const window = rangeBalance(
      [salary, rent, entry({ category: 'food', amountIls: 900, entryDate: day(2026, 1, 9) })],
      { year: 2026, month: 1, day: 1 },
      { year: 2026, month: 1, day: 31 },
    );

    expect(expensesByCategory(window).map((row) => row.category)).toEqual(['housing', 'food']);
  });
});
