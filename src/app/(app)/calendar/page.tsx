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
import { formatCompactSigned, formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { wallClock } from '@/lib/time/zone';
import { formatMonthName } from '@/lib/time/format';

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

          const background = !total
            ? 'var(--tri-raised)'
            : total.net >= 0
              ? 'var(--tri-pos-soft)'
              : 'var(--tri-neg-soft)';
          const border = !total
            ? 'var(--tri-line)'
            : total.net >= 0
              ? 'var(--tri-pos-edge)'
              : 'var(--tri-neg-edge)';

          return (
            <div
              key={key}
              className="rounded-xl border px-1 py-1.5 md:px-2"
              style={{ background, borderColor: border }}
              title={
                total
                  ? `${money(total.net, { signed: true })} · ${t('kpi.tradesCount', { count: total.count })}`
                  : undefined
              }
            >
              <div className="text-dim text-[11px]">{day}</div>
              {total ? (
                <>
                  {/*
                   * Two renderings of the same number. A phone gives each square about forty
                   * pixels of text, which `+₪1,165` does not fit into — it wrapped mid-figure
                   * and collided with the next day. The compact form fits; the full one comes
                   * back as soon as there is room for it.
                   */}
                  <div className={`font-bold ${total.net >= 0 ? 'text-pos' : 'text-neg'}`}>
                    {/* The visibility class goes on the wrapper: `Num` sets its own
                        `inline-block`, which would win over `hidden` on the same element. */}
                    <span className="text-[13px] md:hidden">
                      <Num>{formatCompactSigned(total.net * display.rate, locale)}</Num>
                    </span>
                    <span className="hidden text-xs md:inline">
                      <Num>{money(total.net, { signed: true })}</Num>
                    </span>
                  </div>
                  <div className="text-dim text-[10px]">
                    <Num>
                      {total.count}
                      <span className="hidden md:inline">
                        {' · '}
                        {formatNumber((total.wins / total.count) * 100, locale, 0)}%
                      </span>
                    </Num>
                  </div>
                </>
              ) : (
                <div className="text-dim/50 text-[11px]">{t('calendar.noTrades')}</div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
