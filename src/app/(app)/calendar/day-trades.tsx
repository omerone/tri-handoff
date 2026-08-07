'use client';

import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Num } from '@/components/ui/kpi';

/**
 * A day's trades, opened from its square.
 *
 * The square could say three things — the net, the count and the win rate — and the hover card
 * behind it said the same three in longer words. Neither answered the question a trader asks of
 * a green day: *which* trades. That meant leaving the calendar for the table and narrowing it
 * back down to the day already being pointed at.
 *
 * A dialog rather than a link to a filtered table, because the calendar is a place you scan:
 * you open a day, read it, close it and carry on down the month. A navigation each way turns
 * that into two page loads per square.
 *
 * The rows arrive already formatted. Money and dates are the request's job — its locale, its
 * display currency, its timezone — and a formatter cannot cross into a client component
 * anyway, which is written on `day-cell.tsx` because it cost `/calendar` a hard error once.
 */

export type DayTradeRow = {
  id: string;
  href: string;
  symbol: string;
  direction: 'long' | 'short';
  /** Already translated: "Day", "Swing". */
  style: string;
  /** `HH:mm`, in the analytics timezone. */
  closedAt: string;
  /** Signed and in the reader's currency. */
  pnl: string;
  won: boolean;
  /** `+1.33R`, or null when the trade has none — see `explainMissingRr`. */
  rr: string | null;
  risk: string | null;
};

export type DayTradesLabels = {
  trades: string;
  netPnl: string;
  winRate: string;
  rr: string;
  risk: string;
  close: string;
  /** "Open this trade" — the row is a link and says where it goes. */
  openTrade: string;
};

export function DayTrades({
  dateLabel,
  summary,
  rows,
  labels,
  children,
}: {
  dateLabel: string;
  /** The three figures the square already shows, so the dialog opens by confirming them. */
  summary: { pnl: string; up: boolean; count: number; winRate: string; wins: string };
  rows: readonly DayTradeRow[];
  labels: DayTradesLabels;
  /** The square itself. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      {/*
        The square becomes the button. `display: contents` so the button adds no box of its own
        — the grid is sized by its cells, and a wrapper between them and the grid would give
        every square a second, differently-sized parent.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={`${dateLabel} · ${summary.pnl}`}
        className="contents text-start"
      >
        {children}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="presentation"
        >
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />

          {/*
            A sheet from the bottom edge on a phone, a card in the middle from `sm`. Both are
            capped and scroll inside themselves: a day with twenty trades is longer than any
            screen, and a dialog taller than the viewport puts its own close button out of
            reach.
          */}
          <div
            id={dialogId}
            role="dialog"
            aria-modal
            aria-label={dateLabel}
            className="bg-surface border-line tri-sheet-up relative flex max-h-[85vh] w-full flex-col rounded-t-[18px] border-t shadow-2xl sm:max-w-lg sm:rounded-[18px] sm:border"
          >
            <div className="border-line flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="text-text text-sm font-bold">{dateLabel}</div>
                <div className="text-dim mt-0.5 text-[11px]">
                  <Num>{summary.count}</Num> {labels.trades}
                  {' · '}
                  <Num>{summary.wins}</Num> <Num>{`(${summary.winRate})`}</Num>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`text-sm font-bold ${summary.up ? 'text-pos' : 'text-neg'}`}
                >
                  <Num>{summary.pnl}</Num>
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={labels.close}
                  className="tri-tap text-dim hover:text-text flex size-8 items-center justify-center rounded-lg"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>

            <ul className="divide-line divide-y overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id}>
                  {/* The whole row is the link. A day is read by scanning it, and a trade worth
                      opening is worth opening without aiming at a 14-pixel icon. */}
                  <Link
                    href={row.href}
                    aria-label={`${labels.openTrade}: ${row.symbol}`}
                    className="hover:bg-raised/60 flex items-center gap-3 px-4 py-3"
                  >
                    <span
                      aria-hidden
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ background: row.won ? 'var(--tri-pos)' : 'var(--tri-neg)' }}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-text text-[13px] font-bold" dir="ltr">
                          {row.symbol}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 text-[11px] ${
                            row.direction === 'long' ? 'text-pos' : 'text-neg'
                          }`}
                        >
                          {row.direction === 'long' ? (
                            <ArrowUpRight size={11} aria-hidden />
                          ) : (
                            <ArrowDownRight size={11} aria-hidden />
                          )}
                        </span>
                        <span className="text-dim text-[11px]">{row.style}</span>
                      </span>
                      <span className="text-dim mt-0.5 flex flex-wrap gap-x-3 text-[11px]">
                        <Num>{row.closedAt}</Num>
                        <span>
                          {labels.rr} <Num>{row.rr ?? '—'}</Num>
                        </span>
                        <span>
                          {labels.risk} <Num>{row.risk ?? '—'}</Num>
                        </span>
                      </span>
                    </span>

                    <span
                      className={`shrink-0 text-sm font-bold ${row.won ? 'text-pos' : 'text-neg'}`}
                    >
                      <Num>{row.pnl}</Num>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
