import { wallClock } from '@/lib/time/zone';
import type { AnalyticsTrade } from './types';

/**
 * Month by month, and year by year.
 *
 * Every figure on the analytics screen describes one selected window. That answers "how did
 * this month go" and cannot answer "am I getting better", which is the question a trading
 * journal exists for. A trader looking at a 62% win rate has no way to know whether it used
 * to be 45% or 80%, and the range picker only lets them ask about one window at a time —
 * comparing four quarters means visiting the screen four times and holding the numbers in
 * their head.
 *
 * The grid is the standard shape in every fund report and every commercial journal, and it is
 * standard because it works: twelve columns and a row per year, and the shape of the account
 * is visible in one look. Losing streaks show up as runs of red across a row rather than as a
 * number nobody plotted.
 *
 * **The percentage compounds.** Each month's return is measured against the balance the month
 * *opened* with, not against the original deposit — which is what makes the column comparable
 * across years. Making 2,000 on a 20,000 account is 10%; making the same 2,000 two years later
 * on 80,000 is 2.5%, and a table that called both "2,000" would hide the entire story.
 */

export type PeriodReturn = {
  /** `YYYY-MM` for a month, `YYYY` for a year. */
  key: string;
  year: number;
  /** 1-12, or null on a year row. */
  month: number | null;
  net: number;
  trades: number;
  wins: number;
  winRate: number;
  /** Balance the period opened with — the denominator of `percent`. */
  openingBalance: number;
  /**
   * Return over that opening balance.
   *
   * Null when the balance was zero or negative, which is not a base anything can be a
   * percentage of. The money figure is always there, so a period with no percentage is still
   * readable rather than blank.
   */
  percent: number | null;
};

const emptyPeriod = (key: string, year: number, month: number | null): PeriodReturn => ({
  key,
  year,
  month,
  net: 0,
  trades: 0,
  wins: 0,
  winRate: 0,
  openingBalance: 0,
  percent: null,
});

/**
 * One row per calendar month that had trading, oldest first.
 *
 * Months with no trades are left out here and filled in by the grid, which knows how many
 * columns it is drawing. Keeping them out means `monthlyReturns` can be read as "the months
 * this trader traded" and the balance still rolls forward correctly, because a month with no
 * trades changes nothing about it.
 *
 * Bucketed by close date in the analytics time zone, matching `dailyTotals` and the calendar.
 * A swing trade opened in March and closed in April earned its money in April.
 */
export function monthlyReturns(
  trades: readonly AnalyticsTrade[],
  startBalance: number,
): PeriodReturn[] {
  const months = new Map<string, PeriodReturn>();

  for (const trade of trades) {
    const { year, month } = wallClock(trade.closeAt);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const period = months.get(key) ?? emptyPeriod(key, year, month);
    period.net += trade.profit;
    period.trades += 1;
    if (trade.profit > 0) period.wins += 1;
    months.set(key, period);
  }

  // Chronological, so the running balance below means what it says.
  const ordered = [...months.values()].sort((a, b) => a.key.localeCompare(b.key));

  let balance = startBalance;
  for (const period of ordered) {
    period.openingBalance = balance;
    period.percent = balance > 0 ? (period.net / balance) * 100 : null;
    period.winRate = period.trades > 0 ? (period.wins / period.trades) * 100 : 0;
    balance += period.net;
  }

  return ordered;
}

/**
 * The same list folded up by year.
 *
 * Derived from the months rather than recomputed from the trades, so the row total is the sum
 * of the cells beside it by construction. A year row that disagreed with its own twelve months
 * — because one summed trades and the other summed months — is the kind of discrepancy nobody
 * notices until a client does.
 *
 * The year's percentage is against the balance it opened with, which is its first month's
 * opening balance. That makes it a true compounded return for the year and *not* the sum of
 * the monthly percentages, which would be wrong in a way that looks right.
 */
export function yearlyReturns(months: readonly PeriodReturn[]): PeriodReturn[] {
  const years = new Map<number, PeriodReturn>();

  for (const month of months) {
    const year = years.get(month.year);
    if (!year) {
      years.set(month.year, {
        ...emptyPeriod(String(month.year), month.year, null),
        openingBalance: month.openingBalance,
      });
    }
    const row = years.get(month.year)!;
    row.net += month.net;
    row.trades += month.trades;
    row.wins += month.wins;
  }

  for (const row of years.values()) {
    row.winRate = row.trades > 0 ? (row.wins / row.trades) * 100 : 0;
    row.percent = row.openingBalance > 0 ? (row.net / row.openingBalance) * 100 : null;
  }

  return [...years.values()].sort((a, b) => a.year - b.year);
}

export type MonthGrid = {
  year: number;
  /** Twelve entries, January first. Null where the month had no trades. */
  months: (PeriodReturn | null)[];
  total: PeriodReturn;
};

/**
 * The grid the screen draws: a row per year, twelve cells, and the year's total.
 *
 * Empty months are `null` rather than a zero-valued period, because "traded and broke even"
 * and "did not trade" are different facts and a grid that renders both as ₪0 says the wrong
 * one. The cell renders blank.
 */
export function monthGrid(months: readonly PeriodReturn[]): MonthGrid[] {
  const years = yearlyReturns(months);

  return years.map((total) => ({
    year: total.year,
    months: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return months.find((entry) => entry.year === total.year && entry.month === month) ?? null;
    }),
    total,
  }));
}
