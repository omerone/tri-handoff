'use client';

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Num } from '@/components/ui/kpi';
import { formatCompactSigned, formatNumber } from '@/lib/money/currency';
import type { Locale } from '@/i18n/config';

export type DayTotal = {
  net: number;
  count: number;
  wins: number;
};

export function DayCell({
  day,
  total,
  year,
  month,
  locale,
  money,
  display,
}: {
  day: number;
  total: DayTotal | undefined;
  year: number;
  month: number;
  locale: Locale;
  money: (amount: number, options?: { signed?: boolean }) => string;
  display: { rate: number };
}) {
  const t = useTranslations();
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const cellRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (!total) return;
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect();
      setPopoverPos({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    }
    setShowPopover(true);
  };

  const handleMouseLeave = () => {
    setShowPopover(false);
  };

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
    <>
      <div
        ref={cellRef}
        className="rounded-xl border px-1 py-1.5 md:px-2 cursor-pointer transition-transform hover:scale-105"
        style={{ background, borderColor: border }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="text-dim text-[11px]">{day}</div>
        {total ? (
          <>
            <div className={`font-bold ${total.net >= 0 ? 'text-pos' : 'text-neg'}`}>
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
                  {formatNumber(winRate, locale, 0)}%
                </span>
              </Num>
            </div>
          </>
        ) : (
          <div className="text-dim/50 text-[11px]">{t('calendar.noTrades')}</div>
        )}
      </div>

      {/* Popover Tooltip */}
      {showPopover && total && (
        <div
          className="fixed bg-raised border-line rounded-lg border shadow-lg p-3 z-50 w-64"
          style={{
            left: `${popoverPos.x}px`,
            top: `${popoverPos.y - 10}px`,
            transform: 'translate(-50%, -100%)',
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Date */}
          <div className="text-text text-xs font-semibold mb-2">
            {getMonthName({ year, month }, locale)}, יום {day}
          </div>

          {/* Divider */}
          <div className="border-line border-t mb-2" />

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {/* Net P&L */}
            <div className="flex flex-col">
              <div className="text-dim mb-1">רווח/הפסד נטו</div>
              <div className={`font-bold text-sm ${total.net >= 0 ? 'text-pos' : 'text-neg'}`}>
                {money(total.net, { signed: true })}
              </div>
            </div>

            {/* Trade Count */}
            <div className="flex flex-col">
              <div className="text-dim mb-1">עסקאות</div>
              <div className="font-bold text-sm text-text">{total.count}</div>
            </div>

            {/* Win Rate */}
            <div className="flex flex-col">
              <div className="text-dim mb-1">אחוז הצלחה</div>
              <div className="font-bold text-sm text-text">{formatNumber(winRate, locale, 0)}%</div>
            </div>

            {/* Winning Trades */}
            <div className="flex flex-col">
              <div className="text-dim mb-1">עסקאות רווחיות</div>
              <div className="font-bold text-sm text-pos">{total.wins}</div>
            </div>
          </div>

          {/* Arrow pointing down */}
          <div
            className="absolute left-1/2 transform -translate-x-1/2 w-2 h-2 bg-raised border-line border-r border-b"
            style={{
              top: '100%',
              marginTop: '-5px',
              transform: 'translate(-50%, 0) rotate(45deg)',
            }}
          />
        </div>
      )}
    </>
  );
}

function getMonthName(
  date: { year: number; month: number },
  locale: Locale,
): string {
  const months = {
    en: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
    he: [
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
    ],
  };
  return months[locale]?.[date.month - 1] || `Month ${date.month}`;
}
