import type { ReactNode } from 'react';

export type Tone = 'pos' | 'neg' | 'neutral';

/**
 * A number rendered as its own left-to-right run.
 *
 * Without this, Hebrew breaks every signed figure in the product. "-₪2,085" is a string of
 * bidi-neutral characters, so inside an RTL paragraph the sign is laid out at the visual
 * *right* and the tile reads "₪2,085-" — which a trader would read as 2,085, positive. The
 * `dir="ltr"` attribute opens a new bidi context for the number while the surrounding block
 * keeps its RTL alignment, so the figure reads correctly and still sits where a Hebrew
 * reader expects to find it.
 */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`tri-num inline-block ${className}`}>
      {children}
    </span>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  pos: 'text-pos',
  neg: 'text-neg',
  neutral: 'text-text',
};

/**
 * The KPI tile from the prototype: dim label, big mono figure, small sub-line.
 *
 * The figure is mono because these are read in a row and compared down the column — tabular
 * figures keep the digits aligned, which proportional ones do not.
 */
export function KPI({
  label,
  value,
  sub,
  tone = 'neutral',
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className="border-line bg-surface rounded-[18px] border px-4 py-3" title={title}>
      <div className="text-dim text-xs">{label}</div>
      <div className={`text-[22px] leading-tight font-bold ${TONE_CLASS[tone]}`}>
        <Num>{value}</Num>
      </div>
      {sub ? <div className="text-dim mt-0.5 text-[11px]">{sub}</div> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'brand',
}: {
  children: ReactNode;
  tone?: 'brand' | 'pos' | 'neg' | 'dim';
}) {
  const classes = {
    brand: 'bg-brand/15 text-brand',
    pos: 'bg-pos/15 text-pos',
    neg: 'bg-neg/15 text-neg',
    dim: 'bg-raised text-dim',
  }[tone];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${classes}`}
    >
      {children}
    </span>
  );
}

/** The prototype's empty state: centred, quiet, never a spinner that never resolves. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-dim py-8 text-center text-sm">{children}</p>;
}
