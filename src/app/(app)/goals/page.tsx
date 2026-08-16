import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { EmptyState, KPI, Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { listGoals } from '@/lib/db';
import { currentBrother } from '@/lib/preferences/brother';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import {
  planWeek,
  shiftWeeks,
  startOfWeek,
  weekDays,
  weekProgress,
  weeklyRates,
} from '@/lib/goals/week';
import { formatPercent } from '@/lib/money/currency';
import { formatWeekdayDate, isoToDayMonth, parseIsoDate } from '@/lib/time/format';
import { wallClock } from '@/lib/time/zone';
import { DayAdd, GoalRow } from './goal-form';

/** How many weeks of history the trend reads. Six is a month and a half — long enough to be a
 *  trend, short enough that every bar is a week the person remembers. */
const TREND_WEEKS = 6;

/**
 * The week's checklist, and how much of it is being kept.
 *
 * Two questions on one screen, and they are not the same question. The list answers "what am I
 * doing on Thursday"; the figures above it answer "am I actually doing any of this" — which is
 * the one nobody asks themselves honestly without a number in front of them.
 */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations('goals');
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  // Whose week. Like the ledger and the study hours — see the header switch.
  const brother = await currentBrother();

  const today = isoOf(wallClock(new Date()));
  /*
   * The week on screen. `?week=` is trusted only as far as being a date: anything else falls
   * back to this one, because a malformed value should show the current week rather than an
   * error page over a checklist.
   */
  const asked = params.week && parseIsoDate(params.week) ? params.week : today;
  const start = startOfWeek(asked);
  const days = weekDays(start);
  const end = days[6]!;

  /*
   * One query for the trend, and the week on screen is read out of it.
   *
   * The alternative is two queries whose ranges overlap, which is a second chance to disagree
   * about where a week begins. `weeklyRates` and `planWeek` both take goals and pick out what
   * belongs to them, so the same rows serve both.
   */
  const trendStart = shiftWeeks(start, -(TREND_WEEKS - 1));
  const goals = await listGoals(session.ctx, brother, trendStart, end);

  const plan = planWeek(days, goals);
  const progress = weekProgress(plan, today);
  const trend = weeklyRates(
    Array.from({ length: TREND_WEEKS }, (_, index) => shiftWeeks(trendStart, index)),
    goals,
    today,
  );

  const dayOptions = days.map((day) => ({
    value: day,
    label: formatWeekdayDate(parseIsoDate(day)!, locale),
  }));
  const addLabels = {
    add: t('add'),
    placeholder: t('goalPlaceholder'),
    save: t('save'),
    cancel: t('cancel'),
    field: t('goalTitle'),
  };

  const rowLabels = {
    done: t('markDone'),
    edit: t('edit'),
    remove: t('remove'),
    save: t('save'),
    cancel: t('cancel'),
    title: t('goalTitle'),
    day: t('day'),
  };

  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const navButton =
    'border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/*
          Kept out of what was *due*, not out of the whole week — see `weekProgress`. A week is
          written in advance, so scoring Sunday against Friday's goals reports a collapse on a
          day nothing has gone wrong.
        */}
        <KPI
          label={t('kept')}
          value={progress.rate === null ? '—' : formatPercent(progress.rate * 100, locale, 0)}
          sub={t('keptOf', { done: progress.doneOfDue, due: progress.due })}
          tone={progress.rate === null ? undefined : progress.rate >= 0.8 ? 'pos' : progress.rate >= 0.5 ? undefined : 'neg'}
        />
        <KPI
          label={t('daysKept')}
          value={`${progress.daysKept}/${progress.daysWithGoals}`}
          sub={t('daysKeptSub')}
        />
        <KPI
          label={t('missed')}
          value={String(progress.missed)}
          sub={t('missedSub')}
          tone={progress.missed > 0 ? 'neg' : undefined}
        />
        <KPI label={t('planned')} value={String(progress.total)} sub={t('plannedSub')} />
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            {t('week')}
            <Num>
              <span className="text-dim text-xs font-normal">
                {isoToDayMonth(start)} – {isoToDayMonth(end)}
              </span>
            </Num>
          </span>
        }
        action={
          <div className="flex items-center gap-1.5">
            <Link href={`/goals?week=${shiftWeeks(start, -1)}`} aria-label={t('previousWeek')} className={navButton}>
              <Prev size={15} aria-hidden />
            </Link>
            <Link
              href="/goals"
              className="border-line bg-raised text-dim hover:text-text rounded-lg border px-2 py-1 text-[11px] font-semibold"
            >
              {t('thisWeek')}
            </Link>
            <Link href={`/goals?week=${shiftWeeks(start, 1)}`} aria-label={t('nextWeek')} className={navButton}>
              <Next size={15} aria-hidden />
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {progress.total === 0 ? <p className="text-dim text-xs">{t('empty')}</p> : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plan.map((day) => {
                const isToday = day.date === today;
                const gone = day.date < today;
                return (
                  <section
                    key={day.date}
                    /* Today is raised rather than coloured: the row of days is read at a
                       glance, and a border says "you are here" without spending the accent
                       colour, which the ticks and the misses need. */
                    className={`rounded-[14px] border p-3 ${
                      isToday ? 'border-brand bg-raised' : 'border-line'
                    }`}
                  >
                    <header className="mb-1.5 flex items-baseline justify-between gap-2">
                      <h3 className={`text-[13px] font-bold ${isToday ? 'text-brand' : 'text-text'}`}>
                        {formatWeekdayDate(parseIsoDate(day.date)!, locale)}
                      </h3>
                      {day.total > 0 ? (
                        <span
                          className={`text-[11px] font-semibold ${
                            day.done === day.total ? 'text-pos' : gone ? 'text-neg' : 'text-dim'
                          }`}
                        >
                          <Num>
                            {day.done}/{day.total}
                          </Num>
                        </span>
                      ) : null}
                    </header>

                    {day.goals.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        id={goal.id}
                        title={goal.title}
                        done={goal.done}
                        dueOn={goal.dueOn}
                        days={dayOptions}
                        overdue={gone && !goal.done}
                        labels={rowLabels}
                      />
                    ))}

                    {/* Every day, whether or not it holds anything: the button is how a goal
                        is written, so a day without one is a day you cannot write to. */}
                    <DayAdd owner={brother} day={day.date} labels={addLabels} />
                  </section>
                );
              })}
          </div>
        </div>
      </Card>

      <Card title={t('trend')} info={t('trendInfo')} infoLabel={t('trend')}>
        {trend.every((week) => week.rate === null) ? (
          <EmptyState>{t('trendEmpty')}</EmptyState>
        ) : (
          <div className="flex items-end justify-between gap-2">
            {trend.map((week) => {
              const height = week.rate === null ? 0 : Math.max(3, Math.round(week.rate * 100));
              return (
                <div key={week.start} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-dim text-[10px]">
                    {week.rate === null ? '—' : formatPercent(week.rate * 100, locale, 0)}
                  </span>
                  {/* A fixed track, so a bar is read against the same ceiling every week
                      rather than against whichever week happened to be the best one. */}
                  <div className="bg-raised flex h-24 w-full items-end overflow-hidden rounded-[8px]">
                    <div
                      className={`w-full rounded-[8px] ${
                        week.rate === null
                          ? ''
                          : week.rate >= 0.8
                            ? 'bg-pos'
                            : week.rate >= 0.5
                              ? 'bg-warn'
                              : 'bg-neg'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] ${week.start === start ? 'text-text font-bold' : 'text-dim'}`}
                  >
                    <Num>{isoToDayMonth(week.start)}</Num>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

const isoOf = (parts: { year: number; month: number; day: number }) =>
  `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
