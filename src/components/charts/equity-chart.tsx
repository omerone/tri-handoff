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
import { formatDisplayMoney, type MoneyDisplay } from '@/lib/money/currency';
import { ChartTooltip } from './chart-tooltip';

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
export function EquityChart({
  data,
  startBalance,
  rtl,
  display,
}: {
  data: EquityDatum[];
  startBalance: number;
  rtl: boolean;
  display: MoneyDisplay;
}) {
  const format = (value: number) => formatDisplayMoney(value, display);
  return (
    <div style={{ height: 240 }}>
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
            width={64}
            tickFormatter={format}
            domain={['dataMin - 200', 'dataMax + 200']}
            orientation={rtl ? 'right' : 'left'}
          />
          <Tooltip
            content={<ChartTooltip format={format} />}
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
  );
}
