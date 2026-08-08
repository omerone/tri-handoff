'use client';

import type { TooltipProps } from 'recharts';

/**
 * An optional second line under the figure.
 *
 * Returned by the caller rather than computed here, because only the caller knows what the
 * number means: the equity curve uses it for the change since the account opened, and the
 * breakdown chart has nothing to add and passes nothing.
 */
export type TooltipNote = { label: string; text: string; tone: 'pos' | 'neg' | 'dim' };

const TONE_CLASS: Record<TooltipNote['tone'], string> = {
  pos: 'text-pos',
  neg: 'text-neg',
  dim: 'text-dim',
};

/** The prototype's dark tooltip: dim label, mono value on the raised surface. */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  note,
}: TooltipProps<number, string> & {
  format: (value: number) => string;
  /** Given the hovered value, the extra line to draw — or null for none. */
  note?: (value: number) => TooltipNote | null;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0];
  const value = typeof point?.value === 'number' ? point.value : null;
  if (point === undefined || value === null) return null;

  // Recharts hands back the raw datum; the server puts a preformatted `label` on it, so the
  // tooltip never has to know the locale.
  const heading = (point.payload as { label?: string } | undefined)?.label ?? String(label ?? '');
  const extra = note?.(value) ?? null;

  return (
    <div className="border-line bg-raised rounded-[10px] border px-2.5 py-1.5 text-xs">
      {heading ? <div className="text-dim">{heading}</div> : null}
      <div className="tri-num text-text">{format(value)}</div>
      {extra ? (
        <div className="mt-0.5 flex items-baseline gap-1.5 text-[11px]">
          <span className="text-dim">{extra.label}</span>
          {/*
            Its own left-to-right run, for the reason `Num` exists: this line is the only one
            in the tooltip that carries a sign, and "+12.4% · +₪6,420" inside a Hebrew box is
            a string of bidi-neutral characters — the algorithm would lay the leading sign out
            on the far side and turn a gain into what reads as a loss.
          */}
          <span dir="ltr" className={`tri-num whitespace-nowrap ${TONE_CLASS[extra.tone]}`}>
            {extra.text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
