import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { Num } from '@/components/ui/kpi';
import { requireSession } from '@/lib/auth/session';
import { dailyTotals } from '@/lib/analytics';
import { loadBook } from '@/lib/analytics/load';
import { LOCALE_DIR, LOCALE_TAG, type Locale } from '@/i18n/config';
import { formatNumber } from '@/lib/money/currency';
import { displayMoney } from '@/lib/money/display';
import { ANALYTICS_TIME_ZONE, wallClock } from '@/lib/time/zone';

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
  const { money } = await displayMoney({
    source: book.accountCurrency,
    display: session.user.displayCurrency,
    locale,
  });

  const totals = dailyTotals(book.trades);

  // Default to the month of the most recent trade rather than "now": a demo account, or a
  // trader back from a break, would otherwise open on an empty grid.
  const newest = book.trades.at(-1)?.closeAt ?? new Date();
  const fallback = wallClock(newest);
  const { year, month } = parseMonth(params.m) ?? { year: fallback.year, month: fallback.month };

  const weekdayNames = (await getTranslations('calendar')).raw('weekdays') as string[];
  const monthName = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    month: 'long',
    year: 'numeric',
    timeZone: ANALYTICS_TIME_ZONE,
  }).format(new Date(Date.UTC(year, month - 1, 15)));

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
    const next = month + delta;
    const y = next < 1 ? year - 1 : next > 12 ? year + 1 : year;
    const m = next < 1 ? 12 : next > 12 ? 1 : next;
    return `?m=${y}-${String(m).padStart(2, '0')}`;
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
      <div className="grid grid-cols-7 gap-1.5">
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
              className="rounded-xl border px-2 py-1.5"
              style={{ background, borderColor: border, minHeight: 66 }}
            >
              <div className="text-dim text-[11px]">{day}</div>
              {total ? (
                <>
                  <div className={`text-xs font-bold ${total.net >= 0 ? 'text-pos' : 'text-neg'}`}>
                    <Num>{money(total.net, { signed: true })}</Num>
                  </div>
                  <div className="text-dim text-[10px]">
                    <Num>
                      {total.count} · {formatNumber((total.wins / total.count) * 100, locale, 0)}%
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

function parseMonth(value: string | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 2999) return null;
  return { year, month };
}
