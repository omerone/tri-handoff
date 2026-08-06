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
 *
 * It also never wraps. On a 320px screen a KPI tile broke "-₪979,454" after the minus sign,
 * leaving a line that read "₪979,454" under a stray dash — a loss displayed as a gain to
 * anyone who does not look twice. A figure is one token; if it does not fit, it should
 * overflow visibly rather than rearrange itself into a different number.
 */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`tri-num inline-block whitespace-nowrap ${className}`}>
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
    <div className="border-line bg-surface rounded-[18px] border px-4 py-3" data-tip={title}>
      <div className="text-dim text-xs">{label}</div>
      {/*
        The figure scales with the tile rather than overflowing it: a seven-figure balance at
        a fixed 22px does not fit two-up on a 320px screen, and this is the one number on the
        page that must stay whole. It stops growing at the prototype's 22px.
      */}
      <div
        className={`leading-tight font-bold ${TONE_CLASS[tone]}`}
        style={{ fontSize: 'clamp(17px, 5.6vw, 22px)' }}
      >
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

/**
 * The prototype's empty state: centred, quiet, never a spinner that never resolves.
 *
 * `py-4` rather than `py-8`. A card holding one sentence was 161px tall on the analytics
 * screen — taller than the hold-time card, which holds actual numbers — and there are several
 * of them on a book that has not been filled in yet. Emptiness should take the space of what
 * it says, not the space of what would have been there.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-dim py-4 text-center text-sm">{children}</p>;
}
