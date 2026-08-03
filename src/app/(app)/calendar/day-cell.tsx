import { Num } from '@/components/ui/kpi';
import {
  formatCompactSigned,
  formatDisplayMoney,
  formatNumber,
  type MoneyDisplay,
} from '@/lib/money/currency';
import type { Locale } from '@/i18n/config';

/**
 * One square of the month, with the day's detail on hover.
 *
 * A server component, and that is what makes the detail card possible rather than what limits
 * it. As a client component it cost three things: the page could not hand it the request's
 * `money()` formatter — a function cannot cross that boundary, and `/calendar` was a hard
 * error on every request because of it — the card was positioned in viewport coordinates and
 * drifted away from its square on the first scroll, and it opened on `mouseenter` alone, so a
 * keyboard and a touch screen could not reach it at all.
 *
 * `group-hover` and `group-focus-within` do the same job in CSS. That is the arrangement the
 * R-strip's own hover card already uses — see `r-strip.tsx` — and it costs no hydration and
 * no delay on the first hover of the session.
 */

export type DayTotal = {
  net: number;
  count: number;
  wins: number;
};

export type DayCellLabels = {
  netPnl: string;
  trades: string;
  winRate: string;
  noTrades: string;
};

export function DayCell({
  day,
  total,
  locale,
  display,
  labels,
  dateLabel,
  align,
}: {
  day: number;
  total: DayTotal | undefined;
  locale: Locale;
  /**
   * The formatting *rule* as data, not a callback — the same boundary the equity chart
   * documents.
   */
  display: MoneyDisplay;
  labels: DayCellLabels;
  /** `Thursday, 23/07/2026` — formatted on the server, so the square carries no clock. */
  dateLabel: string;
  /** Squares at the ends of a row anchor their card to the row's edge instead of centring it. */
  align: 'start' | 'centre' | 'end';
}) {
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

  const winRate = total ? (total.wins / total.count) * 100 : 0;

  return (
    <div
      // Focusable only when there is something to show: a quiet month should not cost thirty
      // tab stops on the way to the next control.
      tabIndex={total ? 0 : undefined}
      className="group relative rounded-xl border px-1 py-1.5 focus-visible:outline-2 md:px-2"
      style={{ background, borderColor: border }}
    >
      <div className="text-dim text-[11px]">{day}</div>

      {total ? (
        <>
          <div className={`font-bold ${total.net >= 0 ? 'text-pos' : 'text-neg'}`}>
            <span className="text-[13px] md:hidden">
              <Num>{formatCompactSigned(total.net * display.rate, locale)}</Num>
            </span>
            <span className="hidden text-xs md:inline">
              <Num>{formatDisplayMoney(total.net, display, { signed: true })}</Num>
            </span>
          </div>
          <div className="text-dim text-[10px]">
            <Num>
              {total.count}
              <span className="hidden md:inline">
                {' · '}
                {formatNumber(winRate, locale, 0)}%
              </span>
            </Num>
          </div>

          <DayCard
            total={total}
            locale={locale}
            display={display}
            labels={labels}
            dateLabel={dateLabel}
            align={align}
            winRate={winRate}
          />
        </>
      ) : (
        <div className="text-dim/50 text-[11px]">{labels.noTrades}</div>
      )}
    </div>
  );
}

/**
 * The hover card.
 *
 * Rows rather than one flowing line, for the reason the R-strip's card documents: each value
 * is then its own bidi context, and a figure cannot swap places with its label inside the
 * Hebrew layout.
 *
 * `start-0`/`end-0`, not `left`/`right`. The grid's first column sits at the inline start,
 * which is the *right* in Hebrew — anchoring physically pins the outer cards to the wrong
 * edge and pushes them further off screen than centring them did.
 */
function DayCard({
  total,
  locale,
  display,
  labels,
  dateLabel,
  align,
  winRate,
}: {
  total: DayTotal;
  locale: Locale;
  display: MoneyDisplay;
  labels: DayCellLabels;
  dateLabel: string;
  align: 'start' | 'centre' | 'end';
  winRate: number;
}) {
  const position =
    align === 'start' ? 'start-0' : align === 'end' ? 'end-0' : 'left-1/2 -translate-x-1/2';

  return (
    <div
      role="tooltip"
      className={`border-line bg-raised pointer-events-none absolute bottom-full z-30 mb-2 hidden w-max flex-col gap-1 rounded-[10px] border px-3 py-2 shadow-lg group-hover:flex group-focus-within:flex ${position}`}
    >
      <div className="text-text text-[12px] font-bold whitespace-nowrap">{dateLabel}</div>

      <Row label={labels.netPnl}>
        <span className={total.net >= 0 ? 'text-pos' : 'text-neg'}>
          <Num>{formatDisplayMoney(total.net, display, { signed: true })}</Num>
        </span>
      </Row>
      <Row label={labels.trades}>
        <span className="text-text">
          <Num>{total.count}</Num>
        </span>
      </Row>
      <Row label={labels.winRate}>
        <span className="text-text">
          <Num>{formatNumber(winRate, locale, 0)}%</Num>
          {/* `2/4` — winners out of the day's trades, the notation the R-strip and the win-rate
              tile already use. A separate "winning trades" row repeats the denominator. */}
          <span className="text-dim">
            {' '}
            <Num>{`${total.wins}/${total.count}`}</Num>
          </span>
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[11px] whitespace-nowrap">
      <span className="font-bold">{children}</span>
      <span className="text-dim">{label}</span>
    </div>
  );
}
