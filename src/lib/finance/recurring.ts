/**
 * Recurring entries, expanded on read rather than written ahead.
 *
 * A monthly salary is stored as **one row** with `isRecurring`, not as a row per month. Two
 * reasons, and the second is the one that matters: writing rows ahead means choosing how far
 * ahead to write, and then a user who corrects the amount has to be asked whether they mean
 * this month or every month. Expanding on read makes an edit apply everywhere by
 * construction, and there is no horizon to get wrong.
 *
 * The cost is that a month's entries are computed rather than queried, which for a personal
 * budget — tens of rows — is nothing.
 *
 * Pure: no dates from the environment, no I/O.
 */

export type RecurringSource = {
  id: string;
  entryDate: Date;
  isRecurring: boolean;
  /** Last month the series runs; null means "until removed". */
  recurringUntil: Date | null;
};

export type Occurrence<T extends RecurringSource> = T & {
  /** The date this instance falls on — the stored date for a one-off. */
  occurrenceDate: Date;
  /** True when this instance was generated from a recurring rule rather than stored. */
  generated: boolean;
};

/** Calendar day, in UTC, since finance dates are stored as `@db.Date`. */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The instances of `entries` that fall in the given month.
 *
 * A series anchored on the 31st appears on the 30th in April and the 28th in February —
 * clamped rather than skipped. Skipping is the other plausible reading and it is wrong: a
 * salary paid on the last day of the month does not stop existing in February.
 */
export function occurrencesInMonth<T extends RecurringSource>(
  entries: readonly T[],
  year: number,
  month: number,
): Occurrence<T>[] {
  const monthStart = utcDay(year, month, 1);
  const lastDay = daysInMonth(year, month);
  const monthEnd = utcDay(year, month, lastDay);

  const result: Occurrence<T>[] = [];

  for (const entry of entries) {
    if (!entry.isRecurring) {
      if (entry.entryDate >= monthStart && entry.entryDate <= monthEnd) {
        result.push({ ...entry, occurrenceDate: entry.entryDate, generated: false });
      }
      continue;
    }

    // The series has not started yet in this month.
    if (entry.entryDate > monthEnd) continue;
    // …or it has already ended.
    if (entry.recurringUntil !== null && entry.recurringUntil < monthStart) continue;

    const anchorDay = entry.entryDate.getUTCDate();
    const day = Math.min(anchorDay, lastDay);
    const occurrenceDate = utcDay(year, month, day);

    // The first instance is the stored row itself, not a generated one — so the UI can offer
    // to edit the series where it actually lives.
    const isAnchorMonth =
      entry.entryDate.getUTCFullYear() === year && entry.entryDate.getUTCMonth() + 1 === month;

    result.push({ ...entry, occurrenceDate, generated: !isAnchorMonth });
  }

  return result.sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime());
}

/**
 * Every month between the first entry and `through`, newest first — the set of months the
 * user can navigate to. Recurring series extend the range up to `through` even if nothing
 * one-off happened since.
 */
export function monthsWithActivity(
  entries: readonly RecurringSource[],
  through: { year: number; month: number },
): { year: number; month: number }[] {
  if (entries.length === 0) return [through];

  const earliest = entries.reduce(
    (min, entry) => (entry.entryDate < min ? entry.entryDate : min),
    entries[0]!.entryDate,
  );

  const months: { year: number; month: number }[] = [];
  // Bounded so a single mistyped date cannot ask for a list thousands of entries long. Ten
  // years of navigation is more than a personal budget needs, and the entries themselves are
  // still all counted by `cumulativeCash`, which does not iterate.
  const earliestAllowed = monthsBefore(through, MAX_NAVIGABLE_MONTHS);
  let year = Math.max(earliest.getUTCFullYear(), earliestAllowed.year);
  let month =
    year === earliestAllowed.year && earliest.getUTCFullYear() <= earliestAllowed.year
      ? earliestAllowed.month
      : earliest.getUTCMonth() + 1;

  while (year < through.year || (year === through.year && month <= through.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months.reverse();
}

/** Ten years — the furthest back the month navigator will offer. */
export const MAX_NAVIGABLE_MONTHS = 120;

function monthsBefore(
  from: { year: number; month: number },
  count: number,
): { year: number; month: number } {
  const index = from.year * 12 + (from.month - 1) - count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
