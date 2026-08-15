import { toIsoDate } from '@/lib/time/format';

/**
 * A week of goals, and how much of it was kept.
 *
 * Dates here are `yyyy-mm-dd` strings throughout rather than `Date`s. A goal belongs to a day,
 * not to an instant, and every question this module answers — which week is it in, has that
 * day arrived, is it the same day as another one — is a question about the calendar. Strings
 * in this format sort and compare as dates for free, and there is no zone to get wrong.
 */

export type Goal = {
  id: string;
  title: string;
  /** `yyyy-mm-dd`. */
  dueOn: string;
  done: boolean;
};

export type DayPlan = {
  date: string;
  goals: Goal[];
  done: number;
  total: number;
};

/** Midnight UTC of a calendar date, which is where the arithmetic below is exact. */
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/* Read back through the time module rather than off `toISOString`. Every date in the product
   goes through one place, and `format.test.ts` walks the tree to check that it does. */
const isoOf = (date: Date) =>
  toIsoDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });

/**
 * The Sunday of the week containing this date.
 *
 * Sunday because the week this is read in starts on one. An ISO week starting Monday would
 * put Sunday — a working day here, and the first one — at the far end of the row from the
 * Monday it precedes.
 */
export function startOfWeek(iso: string): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return isoOf(date);
}

/** The seven days of a week, from its Sunday. */
export function weekDays(start: string): string[] {
  const from = utc(start);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(from);
    day.setUTCDate(day.getUTCDate() + index);
    return isoOf(day);
  });
}

/** Another week's Sunday, forwards or back. */
export function shiftWeeks(start: string, by: number): string {
  const date = utc(start);
  date.setUTCDate(date.getUTCDate() + by * 7);
  return isoOf(date);
}

/**
 * The goals of a week, laid out day by day.
 *
 * Every day appears, including the empty ones: a week with nothing on Thursday is a week with
 * a free Thursday, and dropping the row would make the grid change shape as goals are added
 * and ticked off.
 */
export function planWeek(days: readonly string[], goals: readonly Goal[]): DayPlan[] {
  const byDay = new Map<string, Goal[]>();
  for (const goal of goals) {
    const list = byDay.get(goal.dueOn);
    if (list) list.push(goal);
    else byDay.set(goal.dueOn, [goal]);
  }

  return days.map((date) => {
    const list = byDay.get(date) ?? [];
    return {
      date,
      goals: list,
      done: list.filter((goal) => goal.done).length,
      total: list.length,
    };
  });
}

export type WeekProgress = {
  /** Everything in the week, whether or not its day has come. */
  total: number;
  done: number;
  /** Goals on days that have arrived — today included, since today is still being lived. */
  due: number;
  doneOfDue: number;
  /** `doneOfDue / due`, or null when nothing is due yet and a percentage would be a fiction. */
  rate: number | null;
  /** Unticked goals on days that are gone. The only number here that is a straight failure. */
  missed: number;
  /** Days already arrived that had goals at all, and how many of those got all of them. */
  daysWithGoals: number;
  daysKept: number;
};

/**
 * How much of a week was kept, as of a given day.
 *
 * The measure is done-over-**due**, not done-over-everything, and that is the whole of the
 * thinking here. A week is written in advance: on Sunday morning a full week of goals is
 * mostly Thursday's and Friday's, and counting those as failures reports 10% kept on a day
 * nothing has gone wrong. The figure would be red every Sunday and green every Saturday
 * regardless of the person's behaviour, which is a measure of the day of the week.
 *
 * So the denominator is the days that have actually happened. `total` is still returned for
 * the screen to say what the rest of the week holds — that is a plan, not a score.
 *
 * A week in the future has nothing due and gets a null rate rather than a zero. Zero is a
 * real answer meaning "nothing was kept"; nothing has been asked of next week yet.
 */
export function weekProgress(plan: readonly DayPlan[], today: string): WeekProgress {
  const sum = (days: readonly DayPlan[], of: (day: DayPlan) => number) =>
    days.reduce((count, day) => count + of(day), 0);

  const arrived = plan.filter((day) => day.date <= today);
  const gone = plan.filter((day) => day.date < today);
  const withGoals = arrived.filter((day) => day.total > 0);

  const due = sum(arrived, (day) => day.total);
  const doneOfDue = sum(arrived, (day) => day.done);

  return {
    total: sum(plan, (day) => day.total),
    done: sum(plan, (day) => day.done),
    due,
    doneOfDue,
    rate: due === 0 ? null : doneOfDue / due,
    // Today is not counted as missed: the day is not over, and a goal still on it is late by
    // nobody's reckoning until midnight.
    missed: sum(gone, (day) => day.total - day.done),
    daysWithGoals: withGoals.length,
    daysKept: withGoals.filter((day) => day.done === day.total).length,
  };
}

export type WeekRate = {
  start: string;
  due: number;
  done: number;
  rate: number | null;
};

/**
 * One rate per week, for reading a run of them side by side.
 *
 * Weeks with nothing due keep a null rate rather than a zero, so a fortnight away does not
 * draw two bars on the floor and read as a collapse.
 */
export function weeklyRates(
  starts: readonly string[],
  goals: readonly Goal[],
  today: string,
): WeekRate[] {
  return starts.map((start) => {
    const progress = weekProgress(planWeek(weekDays(start), goals), today);
    return { start, due: progress.due, done: progress.doneOfDue, rate: progress.rate };
  });
}
