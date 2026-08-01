/**
 * The R-strip — the product's signature element.
 *
 * One bar per trade, most recent last: winners grow up from the centre line, losers down.
 * The height is the R multiple, clamped, so the shape of a trader's last sixty trades is
 * legible in a glance — a run of small wins and one enormous loss looks completely different
 * from the same net P&L earned evenly, and no other chart on the dashboard shows that.
 *
 * Rendered as plain divs rather than through the chart library: it is sixty rectangles, and
 * doing it directly means no client-side JavaScript and no layout shift on load.
 */

/** Bars are clipped here so one outlier does not flatten the rest into invisibility. */
const MAX_R = 3.5;
const MAX_BAR_HEIGHT = 30;
const BASE_BAR_HEIGHT = 4;

export type RStripEntry = {
  id: string;
  symbol: string;
  rr: number | null;
  profit: number;
};

export function RStrip({ trades, formatRr }: { trades: RStripEntry[]; formatRr: (rr: number) => string }) {
  return (
    <div className="flex items-stretch gap-[3px] overflow-x-auto py-1" style={{ height: 72 }}>
      {trades.map((trade) => {
        const won = trade.profit > 0;
        // A trade with no stop loss has no R. It still happened, so it gets a bar — a minimal
        // one, in the direction it went, rather than being dropped and leaving a false gap.
        const magnitude = trade.rr === null ? 0 : Math.min(Math.abs(trade.rr), MAX_R);
        const height = (magnitude / MAX_R) * MAX_BAR_HEIGHT + BASE_BAR_HEIGHT;

        return (
          <div
            key={trade.id}
            title={`${trade.symbol} · ${trade.rr === null ? '—' : formatRr(trade.rr)}`}
            className="flex w-[5px] shrink-0 flex-col justify-center"
          >
            <div className="flex h-8 items-end justify-center">
              {won ? (
                <div className="bg-pos w-[5px] rounded-sm" style={{ height }} />
              ) : null}
            </div>
            <div className="bg-line h-px" />
            <div className="flex h-8 items-start justify-center">
              {won ? null : (
                <div className="bg-neg w-[5px] rounded-sm opacity-90" style={{ height }} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
