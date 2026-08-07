import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

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
  info,
  infoLabel,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  title?: string;
  /**
   * What this figure actually means, in full sentences — see `info-layer.tsx`.
   *
   * A KPI label has room for two or three words, and most of these are terms of art: a profit
   * factor of 0.83 says something precise and says nothing at all to somebody who has not met
   * the term. The alternative to a mark you can press is a label long enough to explain
   * itself, which is a label that no longer fits.
   */
  info?: string;
  /** Usually the label; separate so the panel can name the figure in full. */
  infoLabel?: string;
}) {
  return (
    /*
      One height for every tile on a phone — 80px, three to a row.
      
      A tile used to take its height from its own content: seventy pixels with no sub-line,
      eighty-eight with one, a hundred and five when that line wrapped. Eleven of them two-up
      was six rows, each a different height from the one above, which on a screen that is
      nothing but tiles reads as broken rather than as dense.
      
      Fixed rather than a floor, because a floor still lets the tallest tile in a row drag its
      neighbours up and the next row sit lower. The two lines that vary are pinned instead: the
      label reserves its second line whether it needs it or not, and the sub-line is clamped to
      one. Both are released at `sm`, where there is width for them.
      
      Tighter padding with it: `py-3` twice over is 24 pixels of nothing on a card whose whole
      job is one number, repeated eleven times down a handset.
    */
    <div
      className="border-line bg-surface flex h-[5rem] flex-col rounded-[14px] border px-2.5 py-2 sm:h-auto sm:rounded-[18px] sm:px-4 sm:py-3"
      data-tip={title}
    >
      {/*
        Two shapes, and the plain one is not an optimisation.

        A tile with no explanation renders exactly what it always did: the label as the only
        thing in its div. The moment that became a `<span>` inside a flex row, `div:text-is(…)`
        stopped matching it — and seven tests across the finance and long screens, which find
        a tile by its label because there is nothing else stable to find it by, went red on a
        change to a screen they do not test. Markup nobody needs is still markup somebody
        depends on.
      */}
      {/*
        Two lines of room for the label on a phone, used or not.

        Three-up gives a label about a third of the row, so "Drawdown מקסימלי" wraps and
        "Profit Factor" does not — and the tiles either side of it end up different heights,
        which is the raggedness this screen keeps coming back to. Reserving the second line
        costs about twelve pixels a row and makes every tile identical without truncating a
        single label. It is released at `sm`, where the label has the width to sit on one line.
      */}
      {info ? (
        <div className="text-dim flex min-h-[2.2em] items-center gap-1 text-[10px] leading-tight sm:min-h-0 sm:text-xs">
          <span className="min-w-0">{label}</span>
          <button
            type="button"
            data-info={info}
            aria-label={infoLabel ?? label}
            /* A button, not an icon with a click handler: this opens something, and the
               keyboard and the screen reader both already know what a button is. */
            className="text-dim/50 hover:text-text focus-visible:text-text -m-1 shrink-0 p-1 leading-none"
          >
            <Info size={12} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="text-dim min-h-[2.2em] text-[10px] leading-tight sm:min-h-0 sm:text-xs">{label}</div>
      )}
      {/*
        The figure scales with the tile rather than overflowing it: a seven-figure balance at
        a fixed 22px does not fit two-up on a 320px screen, and this is the one number on the
        page that must stay whole. It stops growing at the prototype's 22px.
      */}
      <div
        className={`leading-tight font-bold ${TONE_CLASS[tone]}`}
        /*
          Three-up changes the arithmetic this clamp exists for. The tile is a third of the
          row, so a seven-figure balance has about 72px on a 320px screen rather than 170 —
          the floor drops to 13px and the ceiling stays where the desktop wants it.
        */
        style={{ fontSize: 'clamp(13px, 4.4vw, 22px)' }}
      >
        <Num>{value}</Num>
      </div>
      {sub ? (
        /*
          One line, clamped, on a phone.
          
          The last of the raggedness was here: some tiles have no sub-line, some have one, and
          "longest: 4 wins · 6 losses" takes two. With a fixed tile height the variation has to
          go somewhere, and the honest place is the least important line on the card — the
          headline is the figure above it. Released at `sm`, where the tile grows to its
          content and the whole sentence fits anyway.
        */
        <div className="text-dim mt-auto line-clamp-1 pt-0.5 text-[10px] leading-tight sm:line-clamp-none sm:text-[11px]">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'brand',
}: {
  children: ReactNode;
  /**
   * `broker` is the theme's second accent and is used for exactly one thing: whether a row
   * came from MT5 or was typed in. It is deliberately not `brand`, which the asset-class chip
   * beside it already uses, and not `pos`/`neg`, which mean money on this screen. A badge that
   * shares a colour with the badge next to it is answering a different question in the same
   * voice, and the question this one answers — "is this mine or the broker's?" — is the first
   * one asked of a figure that looks wrong.
   */
  tone?: 'brand' | 'broker' | 'pos' | 'neg' | 'dim';
}) {
  const classes = {
    brand: 'bg-brand/15 text-brand',
    broker: 'bg-brand-2/15 text-brand-2',
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
