import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { parseYearMonth, stepMonth } from '@/lib/finance/bounds';
import { dailyTotals } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { LOCALE_DIR, type Locale } from '@/i18n/config';
import { displayMoney } from '@/lib/money/display';
import { wallClock } from '@/lib/time/zone';
import { formatMonthName, formatWeekdayDate } from '@/lib/time/format';
import { DayCell } from './day-cell';

/**
 * The month calendar: daily P&L, trade count and win rate per square (SPEC §1.1).
 *
 * Days are the analytics timezone's days, and the totals come from the close date — see
 * `dailyTotals`. Together with the calendar-based day/swing rule in the sync, that means a
 * day trade occupies exactly one square and the month's squares sum to the month's P&L.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const rtl = LOCALE_DIR[locale] === 'rtl';
  const params = await searchParams;

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
  const { year, month } = parseYearMonth(params.m) ?? { year: fallback.year, month: fallback.month };

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
  const monthName = formatMonthName({ year, month }, locale);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  const monthTotal = [...totals.entries()]
    .filter(([key]) => key.startsWith(`${year}-${String(month).padStart(2, '0')}`))
    .reduce((sum, [, day]) => sum + day.net, 0);

  const step = (delta: number) => {
    const next = stepMonth({ year, month }, delta);
    return `?m=${next.year}-${String(next.month).padStart(2, '0')}`;
  };

  const navButton =
    'border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border';
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {monthName}
          <span className={monthTotal >= 0 ? 'text-pos' : 'text-neg'}>
            <Num>{money(monthTotal, { signed: true })}</Num>
          </span>
        </span>
      }
      action={
        <div className="flex gap-1.5">
          <Link href={step(-1)} aria-label={t('calendar.prevMonth')} className={navButton}>
            <Prev size={14} aria-hidden />
          </Link>
          <Link href={step(1)} aria-label={t('calendar.nextMonth')} className={navButton}>
            <Next size={14} aria-hidden />
          </Link>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 md:gap-1.5">
        {weekdayNames.map((name, index) => (
          <div key={index} className="text-dim p-1 text-center text-[11px]">
            {name}
          </div>
        ))}

        {cells.map((day, index) => {
          if (day === null) return <div key={`pad-${index}`} />;

          const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const total = totals.get(key);

          // Which end of the row this square sits on, so its card can anchor rather than
          // hang off the grid. Seven columns, and the padding cells count.
          const column = index % 7;

          return (
            <DayCell
              key={key}
              day={day}
              total={total}
              locale={locale}
              display={display}
              labels={dayLabels}
              dateLabel={formatWeekdayDate({ year, month, day }, locale)}
              align={column === 0 ? 'start' : column === 6 ? 'end' : 'centre'}
            />
          );
        })}
      </div>
    </Card>
  );
}
