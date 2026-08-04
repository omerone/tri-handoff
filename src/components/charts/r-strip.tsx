import { Num } from '@/components/ui/kpi';

/**
 * The R-strip — the product's signature element, now measured in days.
 *
 * One column per calendar day over the last thirty: winning days grow up from the centre
 * line, losing days down, height proportional to the day's net R. The shape of a month is
 * legible in a glance — a run of small green days and one deep red one looks nothing like
 * the same net earned evenly, and no other panel on the dashboard shows that.
 *
 * It used to be one bar per trade. "The last sixty trades" is a different span every time a
 * trader looks at it, and six bars could be six days or one busy afternoon. Days are a span
 * a person can hold: this week against last week.
 *
 * Quiet days keep their slot in the strip. That is what makes it a strip rather than a list —
 * a week off reads as a week off instead of silently closing up.
 *
 * Two layouts, because thirty labelled columns do not fit a phone:
 *
 *  - **Wide:** the strip itself, one column per day, a hover card with the day's detail, and
 *    the date under each column for as long as the dates fit — see `LABELS_FIT_ANYWHERE`.
 *  - **Narrow:** the same days as rows — the day's R, a bar growing left or right from a
 *    centre line, and the date. Every row carries its own date, which is the thing that
 *    cannot survive being squeezed into ten pixels, and the detail is on the row rather than
 *    behind a hover a finger cannot perform. Days with no trades are dropped here: in a
 *    vertical list an empty row is noise rather than information, and the subtitle says how
 *    many days actually traded.
 *
 * Rendered as plain elements rather than through the chart library: it is a few dozen
 * rectangles, and doing it directly means no client-side JavaScript and no layout shift.
 */

/** Clipped here so one outlier does not flatten the rest into invisibility. */
const MAX_R = 4;
const MAX_BAR = 30;
const MIN_BAR = 3;
/** How many columns at each end anchor their hover card to the strip edge. See `DayCard`. */
const EDGE_COLUMNS = 5;

/*
 * When the date under each column stops fitting.
 *
 * A `dd/MM` at 9px is about 26px wide and the columns are separated by 3px, so a label needs
 * roughly 29px of column to itself. The strip is 704px across at the narrowest width it
 * renders at (768px, where the phone layout hands over) and about 960px from `lg` up — which
 * is 24 and 33 columns.
 *
 * Past that the labels do not wrap or ellipsis; they overprint each other into a grey smear
 * that is not a date, is not a scale, and is not legible at any range. So they come off, and
 * the day is read the way the rest of the day's numbers already are: by pointing at it. The
 * hover card carries the full weekday and date, and it is reachable by keyboard too.
 *
 * The span does not disappear with them — the first and last date move to a caption under the
 * strip, so the axis still says what period it covers.
 */
const LABELS_FIT_ANYWHERE = 24;
const LABELS_FIT_WIDE = 33;

/**
 * Columns at each end that anchor their card instead of centring it.
 *
 * Not a constant, because the thing being cleared is measured in pixels and the thing doing
 * the clearing is measured in columns. `EDGE_COLUMNS` was calibrated on a thirty-day strip,
 * where a column is 20px and five of them clear half a card. Once a range can widen the strip
 * to ninety-two days a column is 5px, and five of them clear 25 — a card centred near the end
 * hangs off the screen.
 *
 * So the count is derived instead:
 *
 *     columns needed = half a card ÷ column width
 *                    = CARD_HALF_PX ÷ (STRIP_MIN_PX ÷ count)
 *                    = count × CARD_HALF_PX ÷ STRIP_MIN_PX
 *
 * A fixed fraction was tried first — `count × 0.12` — and it failed in the middle of the
 * range it was meant to cover: at forty columns it still rounds to five, while the columns
 * have already shrunk to 14px. The numbers below are the measured ones, so the arithmetic can
 * be checked rather than tuned.
 */
/** The narrowest the wide layout ever draws the strip: a 768px viewport, less the padding. */
const STRIP_MIN_PX = 700;
/** Half the widest card — a busy day, with a long weekday name in the heading. */
const CARD_HALF_PX = 105;

const edgeColumns = (count: number) =>
  Math.max(EDGE_COLUMNS, Math.ceil((count * CARD_HALF_PX) / STRIP_MIN_PX));

export type DailyREntry = {
  date: string;
  netR: number;
  rrTrades: number;
  count: number;
  wins: number;
  net: number;
};

export type RStripLabels = {
  /** `dd/MM`, for the column and row labels. */
  formatDayMonth: (date: string) => string;
  /** `Thursday, 23/07/2026` — the hover card's heading. */
  formatLongDate: (date: string) => string;
  formatR: (value: number) => string;
  formatMoney: (value: number) => string;
  formatPercent: (value: number) => string;
  tradeCount: (count: number) => string;
  noTrades: string;
  /** Row labels inside the hover card. */
  netR: string;
  netPnl: string;
  winRate: string;
  /** Shown only when some of the day's trades had no stop loss, so R covers fewer of them. */
  rrCoverage: (counted: number, total: number) => string;
};

const barHeight = (netR: number) =>
  (Math.min(Math.abs(netR), MAX_R) / MAX_R) * MAX_BAR + MIN_BAR;

/**
 * The hover card.
 *
 * Replaces the browser's `title`, which took a second to appear, could not be styled, and —
 * because it is one flat string — reordered its own parts inside the Hebrew layout, so
 * "3 trades · +5.20R" rendered as "3+ · 5.20R עסקאות". Laying the values out as rows means
 * each one is its own bidi context and reads correctly.
 *
 * Pure CSS on `group-hover`: the strip stays a server component, so there is no hydration
 * cost and no delay on the first hover of the session. `pointer-events-none` keeps the card
 * from stealing the hover from the column underneath it.
 */
function DayCard({
  day,
  labels,
  align,
}: {
  day: DailyREntry;
  labels: RStripLabels;
  align: 'start' | 'centre' | 'end';
}) {
  const covered = day.rrTrades < day.count;
  // Centred on its column, except near the ends, where a centred card hangs off the strip.
  // Measured at the narrowest width the strip renders at (768px): the first column's card
  // started 34px outside the viewport and the last one ended 38px past it.
  //
  // `start`/`end` rather than `left`/`right`. The columns are a flex row, so the first one
  // sits at the inline start — which is the *right* in Hebrew. Anchoring physically pinned
  // the outer cards to the wrong edge and pushed them further off screen than before.
  const position =
    align === 'start'
      ? 'start-0'
      : align === 'end'
        ? 'end-0'
        : 'left-1/2 -translate-x-1/2';
  return (
    <div
      role="tooltip"
      className={`border-line bg-raised pointer-events-none absolute bottom-full z-30 mb-2 hidden w-max flex-col gap-1 rounded-[10px] border px-3 py-2 shadow-lg group-hover:flex group-focus-within:flex ${position}`}
    >
      <div className="text-text text-[12px] font-bold whitespace-nowrap">
        {labels.formatLongDate(day.date)}
      </div>

      {day.count === 0 ? (
        <div className="text-dim text-[11px] whitespace-nowrap">{labels.noTrades}</div>
      ) : (
        <>
          <Row label={labels.netR}>
            <span className={day.netR >= 0 ? 'text-pos' : 'text-neg'}>
              <Num>{labels.formatR(day.netR)}</Num>
            </span>
          </Row>
          <Row label={labels.netPnl}>
            <span className={day.net >= 0 ? 'text-pos' : 'text-neg'}>
              <Num>{labels.formatMoney(day.net)}</Num>
            </span>
          </Row>
          <Row label={labels.winRate}>
            <span className="text-text">
              <Num>{labels.formatPercent((day.wins / day.count) * 100)}</Num>
              <span className="text-dim">
                {' '}
                <Num>{`${day.wins}/${day.count}`}</Num>
              </span>
            </span>
          </Row>
          <div className="text-dim text-[11px] whitespace-nowrap">
            {labels.tradeCount(day.count)}
          </div>
          {covered ? (
            // R is only defined for trades that had a stop loss. A day whose R came from
            // three of five trades says so rather than looking complete.
            <div className="text-warn text-[10px] whitespace-nowrap">
              {labels.rrCoverage(day.rrTrades, day.count)}
            </div>
          ) : null}
        </>
      )}
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

export function RStrip({ days, labels }: { days: DailyREntry[]; labels: RStripLabels }) {
  // Newest first in the list. The strip reads oldest-to-newest along the line, which is what
  // a timeline does; a vertical list is read top-down, and the day a trader wants is the one
  // they just had.
  const traded = days.filter((day) => day.count > 0).reverse();

  /*
   * Three densities, decided from the column count and then expressed in CSS.
   *
   * The bucket is fixed on the server but the *width* is not, so the middle case — a strip
   * that fits its labels on a laptop and not on a split window — is a media query rather than
   * a guess. That keeps the whole thing a server component: no measuring, no JavaScript, and
   * no reflow after hydration.
   */
  const dense = days.length > LABELS_FIT_WIDE;
  const tight = !dense && days.length > LABELS_FIT_ANYWHERE;
  const edge = edgeColumns(days.length);
  const first = days.at(0);
  const last = days.at(-1);

  return (
    <>
      {/* ---------- Wide: the strip ---------- */}
      <div className="hidden md:block">
        <div className="flex items-stretch gap-[3px]">
          {days.map((day, index) => {
            const up = day.netR >= 0;
            const height = barHeight(day.netR);
            const align =
              index < edge ? 'start' : index >= days.length - edge ? 'end' : 'centre';
            return (
              <div
                key={day.date}
                // `tabIndex` so the same detail is reachable by keyboard: `group-focus-within`
                // opens the card, which a hover-only affordance never would.
                tabIndex={0}
                className="group relative flex min-w-0 flex-1 cursor-default flex-col items-center gap-1 rounded-md focus-visible:outline-2"
              >
                <DayCard day={day} labels={labels} align={align} />

                <div className="w-full group-hover:opacity-80">
                  <div className="flex h-[34px] w-full items-end justify-center">
                    {day.count > 0 && up ? (
                      <div className="bg-pos w-full rounded-sm" style={{ height }} />
                    ) : null}
                  </div>
                  <div className="bg-line h-px w-full" />
                  <div className="flex h-[34px] w-full items-start justify-center">
                    {day.count > 0 && !up ? (
                      <div className="bg-neg w-full rounded-sm opacity-90" style={{ height }} />
                    ) : null}
                  </div>
                </div>

                {dense ? null : (
                  <span
                    className={`text-[9px] ${tight ? 'hidden lg:inline' : ''} ${
                      day.count > 0 ? 'text-dim' : 'text-dim/40'
                    } group-hover:text-text`}
                  >
                    <Num>{labels.formatDayMonth(day.date)}</Num>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* The ends of the span, for the widths where the per-day labels came off. Two dates
            rather than none: without them the strip is a shape with no place on the calendar,
            and the reader has to hover to find out which months they are looking at. */}
        {(dense || tight) && first && last ? (
          <div
            className={`text-dim/70 mt-1 flex justify-between text-[9px] ${dense ? '' : 'lg:hidden'}`}
          >
            <Num>{labels.formatDayMonth(first.date)}</Num>
            <Num>{labels.formatDayMonth(last.date)}</Num>
          </div>
        ) : null}
      </div>

      {/* ---------- Narrow: the same days, one per row, each labelled ---------- */}
      <ul className="flex flex-col md:hidden">
        {traded.map((day) => {
          const up = day.netR >= 0;
          // The track is split down the middle: losing days run left of centre, winning days
          // right, so the eye finds the red without reading a single number.
          const share = Math.min(Math.abs(day.netR), MAX_R) / MAX_R;
          const width = `${Math.max(share * 50, 2)}%`;
          return (
            <li
              key={day.date}
              className="border-line flex items-center gap-3 border-b py-2.5 last:border-b-0"
            >
              <span className="flex w-20 shrink-0 flex-col">
                <span className={`text-[13px] font-bold ${up ? 'text-pos' : 'text-neg'}`}>
                  <Num>{labels.formatR(day.netR)}</Num>
                </span>
                {/* On a phone the day's money is put on the row rather than behind a hover,
                    which a finger cannot perform. */}
                <span className={`text-[10px] ${day.net >= 0 ? 'text-pos/70' : 'text-neg/70'}`}>
                  <Num>{labels.formatMoney(day.net)}</Num>
                </span>
              </span>

              <span className="relative flex h-2 min-w-0 flex-1 items-center">
                <span className="bg-raised absolute inset-0 rounded-full" />
                <span className="bg-line absolute inset-y-0 left-1/2 w-px" />
                <span
                  className={`absolute h-2 rounded-full ${up ? 'bg-pos' : 'bg-neg'}`}
                  style={up ? { left: '50%', width } : { right: '50%', width }}
                />
              </span>

              <span className="flex shrink-0 flex-col items-end">
                <span className="text-text text-[13px] font-bold">
                  <Num>{labels.formatDayMonth(day.date)}</Num>
                </span>
                {/* `2/4` — winners of the day's trades, the same notation the win-rate tile
                    uses. Spelling out "4 trades" beside it repeats the denominator. */}
                <span className="text-dim text-[10px]">
                  <Num>{`${day.wins}/${day.count}`}</Num>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
