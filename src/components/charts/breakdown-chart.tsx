'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOKEN } from '@/lib/theme';
import { formatCompactMoney, formatDisplayMoney, type MoneyDisplay } from '@/lib/money/currency';
import { ChartTooltip } from './chart-tooltip';

export type BreakdownDatum = {
  key: string;
  label: string;
  net: number;
  /** Preformatted on the server: "1.42R · 61%". */
  caption: string;
};

/**
 * A P&L breakdown bar chart — one per dimension on the analytics page.
 *
 * Bars are coloured by sign rather than by category: the question these answer is "does this
 * make me money", and a red bar answers it before the axis is read. The R and win-rate
 * captions sit underneath rather than on the bars, exactly as in the prototype, because
 * three numbers inside a 40px bar is unreadable on a phone.
 */
export function BreakdownChart({
  data,
  rtl,
  display,
  fill = false,
}: {
  data: BreakdownDatum[];
  rtl: boolean;
  display: MoneyDisplay;
  /**
   * Grow into the height the card was given, instead of taking a fixed one.
   *
   * Only true inside the breakdown grid, where the cards fill their row and the short ones
   * have space to hand over. It is a prop rather than the default because `flex-1` needs a
   * parent with a height to divide: in a card that sizes itself to its content — the
   * consistency panel further down the page — the growing version collapsed to nothing and
   * drew an empty frame where the chart had been.
   */
  fill?: boolean;
}) {
  const format = (value: number) => formatDisplayMoney(value, display);
  // The axis gets the short form; the tooltip keeps the exact figure.
  const axisFormat = (value: number) => formatCompactMoney(value, display);

  /*
   * Shorter when there is less to compare.
   *
   * Height is what makes small differences between bars readable, and with ten weekday-hours
   * side by side that matters. With two — long against short, winners against losers — the
   * comparison is one subtraction and the captions underneath already give both figures
   * exactly. A fixed 148px meant a month holding a single trade drew the same tall, mostly
   * empty frame as a year holding ninety-two, on every one of eight cards.
   */
  const height = data.length <= 3 ? 108 : 148;

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : undefined}>
      {/*
        Filling: a floor rather than a height. The card takes its whole grid row, so a
        breakdown sitting beside one with twelve caption lines is handed the difference, and
        the plot spends it rather than leaving it blank under the legend. It stops shrinking at
        the floor — height is what makes small differences between bars readable, and there is
        a point past which the chart no longer answers the question it was drawn for.

        Not filling: exactly that height, because there is nothing to fill.
      */}
      <div
        className={fill ? 'min-h-0 flex-1' : undefined}
        style={fill ? { minHeight: height } : { height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={TOKEN.line} vertical={false} />
            <XAxis
              dataKey="label"
              stroke={TOKEN.dim}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              reversed={rtl}
            />
            <YAxis
              stroke={TOKEN.dim}
              fontSize={10}
              width={44}
              tickFormatter={axisFormat}
              orientation={rtl ? 'right' : 'left'}
            />
            <Tooltip
              content={<ChartTooltip format={format} />}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <ReferenceLine y={0} stroke={TOKEN.dim} />
            {/*
              `maxBarSize`, because a bar's width otherwise depends on how many there are.
              Recharts divides the plot between the categories, so seven weekdays give sensible
              columns and two strategies give two slabs a hundred and fifty pixels wide — the
              same data reading as a much bigger claim, and the reason the by-strategy card
              looked smeared across the screen. Capped, a chart with two categories is two
              ordinary bars with space around them, which is what two categories are.
            */}
            <Bar dataKey="net" radius={[6, 6, 0, 0]} isAnimationActive={false} maxBarSize={56}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={entry.net >= 0 ? TOKEN.pos : TOKEN.neg} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/*
        A wrapping row, and it was briefly a fixed grid of columns instead — twelve captions on
        the by-hour and by-instrument cards wrap to several lines, and those two are the tallest
        things in this grid, which sets the height of everything beside them. Columns saved
        nineteen pixels off a 2,545px page and cut "USDJPY: 1.02R · 60%" to "USDJPY: 1.02R ·",
        because a third of a 440px card is not wide enough for the numbers these exist to show.
        Nineteen pixels is not worth a truncated figure on a page whose whole job is figures.
      */}
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {data.map((entry) => (
          <div key={entry.key} className="text-dim text-[11px]">
            {entry.label}: <span className="tri-num text-text">{entry.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
