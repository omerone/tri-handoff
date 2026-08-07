import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { parseYearMonth, stepMonth, type YearMonth } from '@/lib/finance/bounds';
import { dailyTotals } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { displayMoney } from '@/lib/money/display';
import { MonthDays } from './month-days';
import { wallClock } from '@/lib/time/zone';
import { formatMonthName, formatWeekdayDate } from '@/lib/time/format';
import { DayCell } from './day-cell';

/**
 * The month calendar: daily P&L, trade count and win rate per square (SPEC §1.1).
 *
 * Days are the analytics timezone's days, and the totals come from the close date — see
 * `dailyTotals`. Together with the calendar-based day/swing rule in the sync, that means a
 * day trade occupies exactly one square and the month's squares sum to the month's P&L.
 *
 * One month at a time, stepped with the arrows in its own header.
 *
 * This screen used to follow the shared range picker as well, drawing every month a range
 * covered. Two controls for one decision, and they could disagree: the arrows moved the range
 * out from under the picker, a range of days asked for a period a grid of months cannot draw,
 * and "maximum" on a long account meant sixty grids nobody scrolls to the end of.
 *
 * The unit of a calendar is a month. `?m=` is the month being read, the arrows step it, and
 * `isRangedPath` keeps the picker off this route — see `lib/nav.ts`.
 */
export default async function CalendarPage({
  searchParams,
}: {
  /** `m` only: the month being read. There is no range on this screen — see the note above. */
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  // No window: the grid draws one month and reads the totals for its own squares out of the
  // book. Narrowing the query as well would only mean a month that renders empty because a
  // range set on another screen happens not to reach it.
  const book = await loadBook(session.ctx);
  const { money, display } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  const totals = dailyTotals(book.trades);

  // Default to the month of the most recent trade rather than "now": a demo account, or a
  // trader back from a break, would otherwise open on an empty grid.
  const newest = book.trades.at(-1)?.closeAt ?? new Date();
  const fallback = wallClock(newest);
  const browsed = parseYearMonth(params.m) ?? { year: fallback.year, month: fallback.month };

  const months = [browsed];

  const weekdayNames = (await getTranslations('calendar')).raw('weekdays') as string[];

  // The hover card's words, resolved once. The square itself is a server component, so it
  // reads no translations of its own — the same arrangement every other card on the product
  // uses, and what keeps a Hebrew string from being typed straight into the markup.
  const dayLabels = {
    netPnl: t('kpi.netPnl'),
    trades: t('kpi.trades'),
    winRate: t('kpi.winRate'),
    noTrades: t('calendar.noTrades'),
  };

  // The arrows are the only way the month changes, so they always step `?m=`.
  const token = (value: YearMonth) => `${value.year}-${String(value.month).padStart(2, '0')}`;

  const step = (delta: number) => `?m=${token(stepMonth(browsed, delta))}`;

  const navButton =
    'border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  const arrows = (
    <div className="flex gap-1.5">
      <Link href={step(-1)} aria-label={t('calendar.prevMonth')} className={navButton}>
        <Prev size={14} aria-hidden />
      </Link>
      <Link href={step(1)} aria-label={t('calendar.nextMonth')} className={navButton}>
        <Next size={14} aria-hidden />
      </Link>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 tri-wide">
      {months.map((month, index) => (
        <Card
          key={`${month.year}-${month.month}`}
          title={
            <span className="flex items-center gap-2">
              {formatMonthName(month, locale)}
              <MonthTotal month={month} totals={totals} money={money} />
            </span>
          }
          // On the newest card only. The arrows move the whole range, so one pair belongs to
          // the screen; a three-month range was drawing three identical pairs, each claiming
          // to step the month it sat on.
          action={index === 0 ? arrows : undefined}
        >
          <div className="grid grid-cols-7 gap-1 md:gap-1.5">
            {weekdayNames.map((name, index) => (
              <div key={index} className="text-dim p-1 text-center text-[11px]">
                {name}
              </div>
            ))}

            {cellsOf(month).map((day, index) => {
              if (day === null) return <div key={`pad-${index}`} />;

              const key = dayKey(month.year, month.month, day);
              // Which end of the row this square sits on, so its card can anchor rather than
              // hang off the grid. Seven columns, and the padding cells count.
              const column = index % 7;

              return (
                <DayCell
                  key={key}
                  day={day}
                  total={totals.get(key)}
                  locale={locale}
                  display={display}
                  labels={dayLabels}
                  dateLabel={formatWeekdayDate({ ...month, day }, locale)}
                  align={column === 0 ? 'start' : column === 6 ? 'end' : 'centre'}
                />
              );
            })}
          </div>

          {/*
            The same month, as a list, below `md`. The grid above keeps the shape of the month
            and the list carries the numbers, because a square on a phone has room for one of
            those and was being asked for both.
          */}
          <MonthDays
            days={cellsOf(month)
              .filter((day): day is number => day !== null)
              .map((day) => ({
                day,
                key: dayKey(month.year, month.month, day),
                dateLabel: formatWeekdayDate({ ...month, day }, locale),
              }))
              .filter((entry) => totals.has(entry.key))
              .map((entry) => ({ ...entry, total: totals.get(entry.key)! }))}
            locale={locale}
            display={display}
            labels={dayLabels}
          />
        </Card>
      ))}
    </div>
  );
}

const dayKey = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The month's squares, with the leading blanks that put the 1st under its weekday. */
function cellsOf(month: YearMonth): (number | null)[] {
  const daysInMonth = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay();
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}

function MonthTotal({
  month,
  totals,
  money,
}: {
  month: YearMonth;
  totals: Map<string, { net: number }>;
  money: (value: number, options?: { signed?: boolean }) => string;
}) {
  const prefix = `${month.year}-${String(month.month).padStart(2, '0')}`;
  const net = [...totals.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .reduce((sum, [, day]) => sum + day.net, 0);

  return (
    <span className={net >= 0 ? 'text-pos' : 'text-neg'}>
      <Num>{money(net, { signed: true })}</Num>
    </span>
  );
}
