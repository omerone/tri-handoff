import { describe, expect, it } from 'vitest';
import { planWeek, shiftWeeks, startOfWeek, weekDays, weekProgress, weeklyRates } from './week';

const goal = (id: string, dueOn: string, done = false) => ({ id, title: id, dueOn, done });

describe('the week a day falls in', () => {
  it('starts on Sunday', () => {
    // 12/08/2026 is a Wednesday; its week opened on the 9th.
    expect(startOfWeek('2026-08-12')).toBe('2026-08-09');
  });

  it('leaves a Sunday where it is', () => {
    expect(startOfWeek('2026-08-09')).toBe('2026-08-09');
  });

  it('keeps Saturday in the week it closes rather than the one it opens', () => {
    expect(startOfWeek('2026-08-15')).toBe('2026-08-09');
    expect(startOfWeek('2026-08-16')).toBe('2026-08-16');
  });

  it('crosses a month and a year without help', () => {
    expect(startOfWeek('2026-09-01')).toBe('2026-08-30');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-27');
  });

  it('runs Sunday to Saturday', () => {
    expect(weekDays('2026-08-09')).toEqual([
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
    ]);
  });

  it('steps to a neighbouring week in both directions', () => {
    expect(shiftWeeks('2026-08-09', 1)).toBe('2026-08-16');
    expect(shiftWeeks('2026-08-09', -1)).toBe('2026-08-02');
    expect(shiftWeeks('2026-08-09', 0)).toBe('2026-08-09');
  });
});

describe('a week laid out day by day', () => {
  const days = weekDays('2026-08-09');

  it('keeps the empty days', () => {
    // A week with a free Thursday still has a Thursday; dropping it would make the grid
    // change shape as goals are added and ticked off.
    const plan = planWeek(days, [goal('a', '2026-08-10')]);
    expect(plan).toHaveLength(7);
    expect(plan[0]).toMatchObject({ date: '2026-08-09', total: 0 });
    expect(plan[1]).toMatchObject({ date: '2026-08-10', total: 1, done: 0 });
  });

  it('counts what is ticked on each day', () => {
    const plan = planWeek(days, [
      goal('a', '2026-08-10', true),
      goal('b', '2026-08-10'),
      goal('c', '2026-08-10', true),
    ]);
    expect(plan[1]).toMatchObject({ total: 3, done: 2 });
  });

  it('ignores a goal from another week', () => {
    expect(planWeek(days, [goal('a', '2026-08-20')]).every((day) => day.total === 0)).toBe(true);
  });
});

describe('how much of a week was kept', () => {
  const days = weekDays('2026-08-09');

  /*
   * The measure this exists for, and the one that would otherwise be nonsense.
   *
   * A week is written in advance. On Monday, a full week of goals is mostly Thursday's and
   * Friday's — counting those as failures reports a terrible score on a day nothing has gone
   * wrong, and the figure would climb through every week regardless of behaviour. It is a
   * measure of the day of the week, not of the person.
   */
  it('scores against the days that have happened, not the whole week', () => {
    const plan = planWeek(days, [
      goal('mon', '2026-08-10', true),
      goal('thu', '2026-08-13'),
      goal('fri', '2026-08-14'),
      goal('sat', '2026-08-15'),
    ]);
    const progress = weekProgress(plan, '2026-08-10');

    expect(progress).toMatchObject({ due: 1, doneOfDue: 1, rate: 1, total: 4, done: 1 });
  });

  it('counts today as due, because today is still being lived', () => {
    const plan = planWeek(days, [goal('a', '2026-08-12'), goal('b', '2026-08-12', true)]);
    expect(weekProgress(plan, '2026-08-12')).toMatchObject({ due: 2, doneOfDue: 1, rate: 0.5 });
  });

  it('does not call today’s unticked goals missed', () => {
    // Late by nobody's reckoning until midnight.
    const plan = planWeek(days, [goal('a', '2026-08-12')]);
    expect(weekProgress(plan, '2026-08-12').missed).toBe(0);
  });

  it('counts what was left behind on a day that is gone', () => {
    const plan = planWeek(days, [
      goal('a', '2026-08-10'),
      goal('b', '2026-08-10', true),
      goal('c', '2026-08-11'),
    ]);
    expect(weekProgress(plan, '2026-08-12').missed).toBe(2);
  });

  it('has no rate for a week nothing has been asked of yet', () => {
    // Null rather than zero: zero means "nothing was kept", which is a verdict on a week that
    // has not started.
    const plan = planWeek(weekDays('2026-08-16'), [goal('a', '2026-08-18')]);
    expect(weekProgress(plan, '2026-08-12').rate).toBeNull();
  });

  it('counts a day as kept only when everything on it was', () => {
    const plan = planWeek(days, [
      goal('a', '2026-08-09', true),
      goal('b', '2026-08-10', true),
      goal('c', '2026-08-10'),
    ]);
    const progress = weekProgress(plan, '2026-08-11');
    expect(progress).toMatchObject({ daysWithGoals: 2, daysKept: 1 });
  });

  it('does not count an empty day as a day kept', () => {
    // Nothing planned is not the same as everything done, and a week of empty days scoring
    // seven out of seven is a statistic that rewards not writing anything down.
    const plan = planWeek(days, [goal('a', '2026-08-09', true)]);
    expect(weekProgress(plan, '2026-08-15')).toMatchObject({ daysWithGoals: 1, daysKept: 1 });
  });

  it('scores a week that is entirely past against all of it', () => {
    const plan = planWeek(days, [goal('a', '2026-08-10', true), goal('b', '2026-08-14')]);
    expect(weekProgress(plan, '2026-09-01')).toMatchObject({ due: 2, doneOfDue: 1, rate: 0.5 });
  });
});

describe('a run of weeks read side by side', () => {
  it('gives each week its own rate', () => {
    const rates = weeklyRates(
      ['2026-08-02', '2026-08-09'],
      [
        goal('a', '2026-08-03', true),
        goal('b', '2026-08-04', true),
        goal('c', '2026-08-10', true),
        goal('d', '2026-08-11'),
      ],
      '2026-08-15',
    );
    expect(rates[0]).toMatchObject({ start: '2026-08-02', due: 2, done: 2, rate: 1 });
    expect(rates[1]).toMatchObject({ start: '2026-08-09', due: 2, done: 1, rate: 0.5 });
  });

  it('leaves a week away blank rather than on the floor', () => {
    // A fortnight with nothing written is not two weeks of failure, and two bars on the floor
    // is exactly what that reads as.
    const [away] = weeklyRates(['2026-08-02'], [], '2026-08-15');
    expect(away!.rate).toBeNull();
  });
});
