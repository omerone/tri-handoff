import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, NotebookPen } from 'lucide-react';
import { Chip, EmptyState, Num } from '@/components/ui/kpi';
import { DeleteTradeButton } from './delete-trade-button';

export type ManualTradeView = {
  id: string;
  symbol: string;
  assetClassLabel: string;
  direction: 'long' | 'short';
  directionLabel: string;
  closedAt: string;
  profit: string;
  profitPositive: boolean;
  risk: string | null;
  rr: string | null;
  rrPositive: boolean;
  journalled: boolean;
};

export type ManualTradeListLabels = {
  columns: { symbol: string; direction: string; date: string; risk: string; rr: string; pnl: string };
  journal: string;
  delete: string;
  deleteConfirm: string;
  empty: string;
};

/**
 * The rows this tab has collected.
 *
 * Every one of them is also in the main trades table, in the analytics and on the calendar —
 * they are ordinary trades that happened to arrive by keyboard. This list exists to manage
 * them, which is the one thing the trades table deliberately does not do: it has no delete,
 * because a synced trade must not be removable by hand.
 *
 * The notebook icon goes to the same journal page a synced trade uses, so notes, tags, a
 * rating and the exit-review questions all work here with no extra code.
 */
export function ManualTradeList({
  trades,
  labels,
  rtl,
}: {
  trades: readonly ManualTradeView[];
  labels: ManualTradeListLabels;
  rtl: boolean;
}) {
  if (trades.length === 0) return <EmptyState>{labels.empty}</EmptyState>;

  const align = rtl ? 'text-right' : 'text-left';
  const headers = [
    labels.columns.date,
    labels.columns.symbol,
    '',
    labels.columns.direction,
    labels.columns.risk,
    labels.columns.rr,
    labels.columns.pnl,
    '',
  ];

  return (
    <div className="overflow-x-auto">
      <table className="tri-stack w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-dim text-[11px]">
            {headers.map((header, index) => (
              <th
                key={index}
                className={`border-line border-b px-3 py-2.5 font-semibold ${align}`}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-line border-b last:border-b-0">
              <td className="text-dim px-3 py-2.5 text-xs whitespace-nowrap">
                <Num>{trade.closedAt}</Num>
              </td>
              <td className="px-3 py-2.5 font-bold" dir="ltr">
                {trade.symbol}
              </td>
              <td className="px-3 py-2.5">
                <Chip>{trade.assetClassLabel}</Chip>
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex items-center gap-1 text-xs ${
                    trade.direction === 'long' ? 'text-pos' : 'text-neg'
                  }`}
                >
                  {trade.direction === 'long' ? (
                    <ArrowUpRight size={13} aria-hidden />
                  ) : (
                    <ArrowDownRight size={13} aria-hidden />
                  )}
                  {trade.directionLabel}
                </span>
              </td>
              <td className="px-3 py-2.5 text-xs">
                <Num>{trade.risk ?? '—'}</Num>
              </td>
              <td className="px-3 py-2.5">
                {/* No stop given, so no R — shown as absent rather than as 0R, which would
                    read as a break-even trade. The same rule the trades table follows. */}
                {trade.rr === null ? (
                  <Chip tone="dim">—</Chip>
                ) : (
                  <Chip tone={trade.rrPositive ? 'pos' : 'neg'}>
                    <Num>{trade.rr}</Num>
                  </Chip>
                )}
              </td>
              <td
                className={`px-3 py-2.5 font-bold ${trade.profitPositive ? 'text-pos' : 'text-neg'}`}
              >
                <Num>{trade.profit}</Num>
              </td>
              <td className="px-3 py-2.5 text-end">
                <span className="inline-flex items-center gap-2">
                  <Link
                    href={`/trades/${trade.id}`}
                    aria-label={labels.journal}
                    data-tip={labels.journal}
                    className={`inline-flex ${trade.journalled ? 'text-brand' : 'text-dim/50 hover:text-text'}`}
                  >
                    <NotebookPen size={14} aria-hidden />
                  </Link>

                  <DeleteTradeButton
                    id={trade.id}
                    label={labels.delete}
                    confirm={labels.deleteConfirm}
                  />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
