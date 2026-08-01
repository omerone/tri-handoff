'use client';

import type { TooltipProps } from 'recharts';

/** The prototype's dark tooltip: dim label, mono value on the raised surface. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
}: TooltipProps<number, string> & { format: (value: number) => string }) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0];
  const value = typeof point?.value === 'number' ? point.value : null;
  if (point === undefined || value === null) return null;

  // Recharts hands back the raw datum; the server puts a preformatted `label` on it, so the
  // tooltip never has to know the locale.
  const heading = (point.payload as { label?: string } | undefined)?.label ?? String(label ?? '');

  return (
    <div className="border-line bg-raised rounded-[10px] border px-2.5 py-1.5 text-xs">
      {heading ? <div className="text-dim">{heading}</div> : null}
      <div className="tri-num text-text">{format(value)}</div>
    </div>
  );
}
