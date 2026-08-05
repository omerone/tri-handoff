import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { parseYearMonth, stepMonth, type YearMonth } from '@/lib/finance/bounds';
import { dailyTotals } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { currentResolvedRange } from '@/lib/preferences/range';
import { monthsIn, RANGE_PARAM, toTradeFilter } from '@/lib/time/range';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { displayMoney } from '@/lib/money/display';
import { wallClock } from '@/lib/time/zone';
import { formatMonthName, formatWeekdayDate } from '@/lib/time/format';
import { DayCell } from './day-cell';

/**
 * How many grids a range will render.
 *
 * A year of squares is already a long scroll; "maximum" on a five-year account would be sixty
 * grids and a second of rendering for a page nobody reads to the bottom of. Past this the most
 * recent months are shown and the page says how many were left off, because silently drawing
 * twelve of forty months looks exactly like an account with only twelve months in it.
 */
const MAX_MONTHS = 12;

/**
 * The month calendar: daily P&L, trade count and win rate per square (SPEC §1.1).
 *
 * Days are the analytics timezone's days, and the totals come from the close date — see
 * `dailyTotals`. Together with the calendar-based day/swing rule in the sync, that means a
 * day trade occupies exactly one square and the month's squares sum to the month's P&L.
 *
 * Two modes, and which one is showing follows the range rather than a second control:
 *
 * - **Unbounded** — one month with arrows, which is browsing, and the `?m=` parameter is
 *   where the browsing lives.
 * - **A chosen range** — every month it covers, newest first, and no arrows. Stepping out of
 *   the range would be showing a month the picker above says is not selected.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; range?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

  const range = await currentResolvedRange(params.range);
  const book = await loadBook(session.ctx, toTradeFilter(range));
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

  // Newest first, like every other list in the product: the month a trader is asking about is
  // almost always the last one in the range, and it should not be a scroll away.
  const inRange = range.months ? monthsIn(range.months).reverse() : [];
  const months = range.months ? inRange.slice(0, MAX_MONTHS) : [browsed];
  const dropped = inRange.length - months.length;

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

  /*
   * The arrows move a month in both modes, and what they move depends on which one is showing.
   *
   * Unbounded, they step `?m=` — browsing, which is what an unfiltered calendar is for.
   *
   * With a range chosen they used to disappear entirely, on the reasoning that stepping out of
   * the range would show a month the picker says is not selected. True, and the conclusion was
   * wrong: it left the screen with no way to reach last month at all. Someone who has picked
   * "this month" and wants the one before it has to reopen the picker and build a custom range
   * — for the most ordinary move a calendar has.
   *
   * So they shift the *range* instead, by a month, keeping its length. The picker above stays
   * honest because the range really did change, and the arrow does the obvious thing.
   */
  const token = (value: YearMonth) => `${value.year}-${String(value.month).padStart(2, '0')}`;

  const step = (delta: number) => {
    if (!range.months) {
      const next = stepMonth(browsed, delta);
      return `?m=${token(next)}`;
    }
    const from = stepMonth(range.months.from, delta);
    const to = stepMonth(range.months.to, delta);
    return `?${RANGE_PARAM}=${token(from)}..${token(to)}`;
  };

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
    <div className="flex flex-col gap-4">
      {dropped > 0 ? (
        <p className="text-dim text-xs">
          {t('range.monthsCapped', { shown: months.length, total: inRange.length })}
        </p>
      ) : null}

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
