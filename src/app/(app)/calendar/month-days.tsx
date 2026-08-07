import { Num } from '@/components/ui/kpi';
import { formatDisplayMoney, formatNumber, type MoneyDisplay } from '@/lib/money/currency';
import type { Locale } from '@/i18n/config';
import type { DayCellLabels, DayTotal } from './day-cell';

/**
 * The month's trading days as a list — the phone half of the calendar.
 *
 * The grid stays above this and keeps doing the one thing a grid is for: showing the *shape* of
 * a month at a glance, which days were traded and which were not. What it cannot do at 55
 * pixels a square is carry the numbers. It was trying to: a day's net, its trade count and its
 * win rate crammed into a box the width of a thumbnail, at a font size chosen because nothing
 * larger fitted rather than because anybody could read it.
 *
 * The rest of the detail lived in a card that opens on hover, which on a phone is a card that
 * opens on nothing. `group-hover` needs a pointer and `group-focus-within` needs a focus a tap
 * does not reliably give a `div`, so on the screen where the squares are smallest the numbers
 * behind them were also the least reachable.
 *
 * So the days that have something to say say it here, in rows with room for words. Days with no
 * trades are not in the list at all — a month has twenty of them and they are already visible
 * as the blank squares above.
 */

export function MonthDays({
  days,
  locale,
  display,
  labels,
}: {
  /** Only the days that were traded, in date order, with the weekday label already formatted. */
  days: readonly { key: string; dateLabel: string; total: DayTotal }[];
  locale: Locale;
  display: MoneyDisplay;
  labels: DayCellLabels;
}) {
  if (days.length === 0) return null;

  return (
    <ul className="divide-line mt-3 divide-y border-t md:hidden">
      {days.map((day) => {
        const winRate = (day.total.wins / day.total.count) * 100;
        const up = day.total.net >= 0;

        return (
          <li key={day.key} className="flex items-center gap-3 py-2.5">
            {/* The same colour the square carries, so a row and its day read as one thing. */}
            <span
              aria-hidden
              className="h-8 w-1 shrink-0 rounded-full"
              style={{ background: up ? 'var(--tri-pos)' : 'var(--tri-neg)' }}
            />

            <div className="min-w-0 flex-1">
              <div className="text-text text-[13px] font-semibold">{day.dateLabel}</div>
              <div className="text-dim mt-0.5 text-[11px]">
                <Num>{day.total.count}</Num> {labels.trades}
                {' · '}
                <Num>{`${day.total.wins}/${day.total.count}`}</Num>{' '}
                <Num>{`(${formatNumber(winRate, locale, 0)}%)`}</Num>
              </div>
            </div>

            <span className={`shrink-0 text-sm font-bold ${up ? 'text-pos' : 'text-neg'}`}>
              <Num>{formatDisplayMoney(day.total.net, display, { signed: true })}</Num>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
