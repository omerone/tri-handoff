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
}: {
  data: BreakdownDatum[];
  rtl: boolean;
  display: MoneyDisplay;
}) {
  const format = (value: number) => formatDisplayMoney(value, display);
  // The axis gets the short form; the tooltip keeps the exact figure.
  const axisFormat = (value: number) => formatCompactMoney(value, display);
  return (
    <>
      <div style={{ height: 180 }}>
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
            <Bar dataKey="net" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={entry.net >= 0 ? TOKEN.pos : TOKEN.neg} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {data.map((entry) => (
          <div key={entry.key} className="text-dim text-[11px]">
            {entry.label}: <span className="tri-num text-text">{entry.caption}</span>
          </div>
        ))}
      </div>
    </>
  );
}
