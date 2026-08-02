import { occurrencesInMonth, type RecurringSource } from './recurring';

/**
 * Personal-finance arithmetic. Pure, and ILS-native throughout (SPEC §3.1) — conversion to
 * the user's display currency happens at render time, once, at the boundary.
 */

export type FinanceEntry = RecurringSource & {
  type: 'income' | 'expense';
  category: string;
  label: string;
  amountIls: number;
};

export type MonthBalance = {
  year: number;
  month: number;
  income: number;
  expenses: number;
  /** Income minus expenses — a *flow*, not a balance sheet. */
  net: number;
  entries: (FinanceEntry & { occurrenceDate: Date; generated: boolean })[];
};

export function monthBalance(
  entries: readonly FinanceEntry[],
  year: number,
  month: number,
): MonthBalance {
  const occurrences = occurrencesInMonth(entries, year, month);

  let income = 0;
  let expenses = 0;
  for (const entry of occurrences) {
    if (entry.type === 'income') income += entry.amountIls;
    else expenses += entry.amountIls;
  }

  return { year, month, income, expenses, net: income - expenses, entries: occurrences };
}

export type CategoryTotal = { category: string; total: number; count: number };

/** Expense breakdown for a month, largest first — "where did it go". */
export function expensesByCategory(balance: MonthBalance): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();

  for (const entry of balance.entries) {
    if (entry.type !== 'expense') continue;
    const current = totals.get(entry.category) ?? { category: entry.category, total: 0, count: 0 };
    current.total += entry.amountIls;
    current.count += 1;
    totals.set(entry.category, current);
  }

  return [...totals.values()].sort((a, b) => b.total - a.total);
}

export type YearBalance = {
  year: number;
  income: number;
  expenses: number;
  net: number;
  months: MonthBalance[];
};

/**
 * Balance for part of a year — January through `throughMonth` inclusive.
 *
 * The month bound is the whole point. Recurring entries have no end unless one is set, so
 * expanding a full calendar year projects a salary through December and calls the result
 * "year to date" — a figure that includes months that have not happened. Summing to the
 * month being viewed is what the label actually claims.
 */
export function yearBalance(
  entries: readonly FinanceEntry[],
  year: number,
  throughMonth = 12,
): YearBalance {
  const count = Math.min(12, Math.max(1, throughMonth));
  const months = Array.from({ length: count }, (_, index) => monthBalance(entries, year, index + 1));
  return {
    year,
    income: months.reduce((sum, m) => sum + m.income, 0),
    expenses: months.reduce((sum, m) => sum + m.expenses, 0),
    net: months.reduce((sum, m) => sum + m.net, 0),
    months,
  };
}

/**
 * Cash accumulated from the first entry through the end of the given month.
 *
 * This is the figure that belongs in a net-worth total, and it is **not** the monthly net.
 * The prototype's "total wealth" tile added one month's net to the trading balance, which
 * mixes a flow into a stock: a good January would inflate net worth and a quiet February
 * would deflate it, with no money having moved. The monthly net still has its own tile,
 * where it means what it says.
 *
 * It is a running total of what the user has recorded, not a bank balance — TRi has no
 * opening balance to start from. The UI says so.
 */
export function cumulativeCash(
  entries: readonly FinanceEntry[],
  through: { year: number; month: number },
): number {
  const throughIndex = monthIndex(through.year, through.month);
  let total = 0;

  for (const entry of entries) {
    const sign = entry.type === 'income' ? 1 : -1;
    const start = monthIndexOf(entry.entryDate);
    if (start > throughIndex) continue;

    if (!entry.isRecurring) {
      total += sign * entry.amountIls;
      continue;
    }

    const end = entry.recurringUntil ? monthIndexOf(entry.recurringUntil) : throughIndex;
    const last = Math.min(end, throughIndex);
    if (last < start) continue;

    total += sign * entry.amountIls * (last - start + 1);
  }

  return total;
}

/**
 * Months since year zero. Turns "how many times does this series fall between two months"
 * into subtraction.
 *
 * The earlier version of `cumulativeCash` walked the calendar one month at a time from the
 * oldest entry, re-scanning every entry each step. That is fine for a normal budget and a
 * denial-of-service otherwise: a single entry backdated to the year 1 and a request for
 * `?m=2999-12` produced ~36,000 iterations of a full scan — measured at ten seconds of
 * blocking CPU on the event loop that serves every tenant. Counting instead of iterating
 * makes it one pass over the entries regardless of the dates involved.
 *
 * The count must agree exactly with `occurrencesInMonth`, which includes a series in the
 * month containing `recurringUntil` and in its own anchor month — hence inclusive bounds.
 */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function monthIndexOf(date: Date): number {
  return monthIndex(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * Net worth: the trading account, manual long positions and recorded cash, all in one
 * currency.
 *
 * Each component arrives already converted, because they start in different currencies — the
 * MT5 account in its own, long positions in theirs, cash in shekels — and doing the
 * conversions here would mean this function needing three rates and a currency for each.
 */
export type WealthComponents = {
  trading: number;
  longPositions: number;
  cash: number;
};

export function totalWealth(components: WealthComponents): number {
  return components.trading + components.longPositions + components.cash;
}
