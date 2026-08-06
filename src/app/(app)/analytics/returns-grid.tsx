import { Num } from '@/components/ui/kpi';
import type { MonthGrid } from '@/lib/analytics/periods';

export type ReturnsGridLabels = {
  /** Twelve short month names, January first, in the reader's locale. */
  months: readonly string[];
  year: string;
  total: string;
  /** Formats a cell's tooltip: "12 trades · 58% won". */
  cellTitle: (period: { trades: number; winRate: number }) => string;
};

/**
 * A year per row, twelve months across, and the year's own return at the end.
 *
 * Rendered as an HTML table rather than a chart. The figures are the point — a trader reads
 * down a column to compare Januaries and across a row to see a losing streak — and a bar
 * chart of thirty-six months on a phone is a row of slivers. The table scrolls sideways
 * inside its own container, so the page never does.
 *
 * Percentages are the headline and money is the caption, not the other way round. Making
 * 2,000 on a 20,000 account and 2,000 on an 80,000 account are the same money and very
 * different months, and the whole reason this grid exists is to make that visible.
 */
export function ReturnsGrid({
  grid,
  labels,
  money,
  formatPercent,
  rtl,
}: {
  grid: readonly MonthGrid[];
  labels: ReturnsGridLabels;
  money: (value: number, options?: { signed?: boolean }) => string;
  formatPercent: (value: number) => string;
  rtl: boolean;
}) {
  const align = rtl ? 'text-right' : 'text-left';

  /*
   * Percentages are the headline and money the caption — unless there are no percentages at
   * all, which happens when the account has no recorded deposit to measure against (see
   * `monthlyReturns`). A grid whose every headline is an em dash tells the reader nothing;
   * when there is no base, the money *is* the answer and gets the large type.
   */
  const measured = grid.some(
    (row) => row.total.percent !== null || row.months.some((month) => month?.percent != null),
  );

  const headline = (period: { net: number; percent: number | null }) =>
    measured
      ? period.percent === null
        ? '—'
        : formatPercent(period.percent)
      : money(period.net, { signed: true });

  const caption = (period: { net: number; percent: number | null }) =>
    measured ? money(period.net, { signed: true }) : null;

  const tone = (net: number) => (net > 0 ? 'text-pos' : net < 0 ? 'text-neg' : 'text-dim');

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]" style={{ minWidth: 720 }}>
        <thead>
          <tr className="text-dim text-[10px]">
            <th className={`border-line border-b px-2 py-2 font-semibold ${align}`}>
              {labels.year}
            </th>
            {labels.months.map((month) => (
              <th key={month} className="border-line border-b px-1 py-2 text-center font-semibold">
                {month}
              </th>
            ))}
            <th className="border-line border-b px-2 py-2 text-center font-semibold">
              {labels.total}
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.year} className="border-line border-b last:border-b-0">
              <td className={`text-dim px-2 py-2 text-[11px] font-bold ${align}`}>
                <Num>{row.year}</Num>
              </td>

              {row.months.map((month, index) =>
                month === null ? (
                  // Blank, not ₪0. A month with no trading is not a break-even month.
                  <td key={index} className="px-1 py-2" />
                ) : (
                  <td
                    key={index}
                    className="px-1 py-2 text-center"
                    data-tip={labels.cellTitle(month)}
                  >
                    <div className={`font-bold ${tone(month.net)}`}>
                      <Num>{headline(month)}</Num>
                    </div>
                    {caption(month) === null ? null : (
                      <div className="text-dim text-[10px]">
                        <Num>{caption(month)}</Num>
                      </div>
                    )}
                  </td>
                ),
              )}

              <td className="border-line bg-raised/40 border-s px-2 py-2 text-center">
                <div className={`font-extrabold ${tone(row.total.net)}`}>
                  <Num>{headline(row.total)}</Num>
                </div>
                {caption(row.total) === null ? null : (
                  <div className="text-dim text-[10px]">
                    <Num>{caption(row.total)}</Num>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
