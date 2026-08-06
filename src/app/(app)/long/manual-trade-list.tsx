import { EmptyState } from '@/components/ui/kpi';
import { OpenRowProvider } from './open-row';
import {
  ManualTradeRow,
  type ManualTradeRowLabels,
  type ManualTradeView,
} from './manual-trade-row';

export type { ManualTradeView };

export type ManualTradeListLabels = {
  columns: {
    symbol: string;
    direction: string;
    date: string;
    risk: string;
    rr: string;
    pnl: string;
  };
  empty: string;
  /** Passed straight through to each row — see `ManualTradeRow`. */
  row: ManualTradeRowLabels;
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
    <OpenRowProvider>
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
              <ManualTradeRow key={trade.id} trade={trade} labels={labels.row} />
            ))}
          </tbody>
        </table>
      </div>
    </OpenRowProvider>
  );
}
