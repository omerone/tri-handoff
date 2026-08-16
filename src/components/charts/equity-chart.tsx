'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TOKEN } from '@/lib/theme';
import {
  formatCompactMoney,
  formatDisplayMoney,
  formatPercent,
  type MoneyDisplay,
} from '@/lib/money/currency';
import { returnFromStart } from '@/lib/analytics';
import { ChartTooltip, type TooltipNote } from './chart-tooltip';
import { ChartFigure } from './chart-figure';

export type EquityDatum = { index: number; balance: number; label: string };

/**
 * The equity curve.
 *
 * The formatting *rule* crosses the boundary as data (`MoneyDisplay`), not as a callback —
 * props have to serialise. Both sides then run the same `formatDisplayMoney`, so the axis
 * cannot disagree with the KPI tile above it.
 *
 * The axis flips side in RTL, which Recharts supports directly and is the difference between
 * a Hebrew dashboard that reads naturally and one that reads like a translation.
 */
export type EquityChartLabels = {
  /** Names the graphic. */
  title: string;
  /** The two columns of the readable version. */
  point: string;
  balance: string;
  /**
   * One sentence saying what the curve does, built on the server.
   *
   * Not a function taking the figures: props cross the server boundary as data, and a
   * callback does not serialise — the same rule that put `MoneyDisplay` in this file's
   * signature instead of a formatter. The server has the balances and the same
   * `formatDisplayMoney` this side uses, so it writes the sentence and the two agree.
   */
  summary: string;
};

export function EquityChart({
  data,
  startBalance,
  rtl,
  display,
  fromStartLabel,
  labels,
}: {
  data: EquityDatum[];
  startBalance: number;
  rtl: boolean;
  display: MoneyDisplay;
  /** Names the second tooltip line. Passed in because this side cannot read translations. */
  fromStartLabel: string;
  labels: EquityChartLabels;
}) {
  const format = (value: number) => formatDisplayMoney(value, display);
  // The axis gets the short form; the tooltip keeps the exact figure.
  const axisFormat = (value: number) => formatCompactMoney(value, display);

  /*
   * How far this point is from where the account opened.
   *
   * The dashed reference line already says where that was; this says what the distance from
   * it is worth, in the two units a trader thinks in at once — the percentage, which is
   * comparable across accounts of any size, and the money, which is the actual amount.
   *
   * The percentage needs no conversion: it is a ratio and the display rate cancels out of it.
   * The money beside it goes through `formatDisplayMoney` like every other figure here, so
   * the two lines of the tooltip are always in the same currency.
   *
   * `returnFromStart` returns null when the opening balance was zero or negative, and the
   * whole line is dropped rather than showing a percentage that would be a division by zero
   * or carry the wrong sign — see the note on it.
   */
  const note = (value: number): TooltipNote | null => {
    const delta = value - startBalance;
    const percent = returnFromStart(value, startBalance);
    const money = formatDisplayMoney(delta, display, { signed: true });

    // A percentage of a base we cannot use still leaves the amount, which is always true.
    const text =
      percent === null
        ? money
        : `${percent > 0 ? '+' : ''}${formatPercent(percent, display.locale, 1)} · ${money}`;

    // Neutral exactly at the start, so an unmoved account is not coloured as a gain.
    const tone = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'dim';
    return { label: fromStartLabel, text, tone };
  };
  return (
    /* Shorter on a phone. 240px is a good chart on a desktop and a quarter of the screen on a
       handset, where it competes with the tiles above it rather than with the whitespace it
       has on a monitor. */
    <ChartFigure
      label={labels.title}
      summary={labels.summary}
      table={
        data.length === 0
          ? undefined
          : {
              caption: labels.title,
              columns: [labels.point, labels.balance],
              rows: data.map((point) => [point.label, format(point.balance)]),
            }
      }
      className="h-[180px] sm:h-[240px]"
    >
      <div className="h-[180px] sm:h-[240px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="tri-equity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TOKEN.brand} stopOpacity={0.35} />
              <stop offset="100%" stopColor={TOKEN.brand} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={TOKEN.line} vertical={false} />
          <XAxis dataKey="index" hide />
          <YAxis
            stroke={TOKEN.dim}
            fontSize={11}
            width={48}
            tickFormatter={axisFormat}
            domain={['dataMin - 200', 'dataMax + 200']}
            orientation={rtl ? 'right' : 'left'}
          />
          <Tooltip
            content={<ChartTooltip format={format} note={note} />}
            cursor={{ stroke: TOKEN.line }}
          />
          {/* Where the account started: above the line is profit, below it is not. */}
          <ReferenceLine y={startBalance} stroke={TOKEN.dim} strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={TOKEN.brand}
            strokeWidth={2}
            fill="url(#tri-equity)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </ChartFigure>
  );
}
