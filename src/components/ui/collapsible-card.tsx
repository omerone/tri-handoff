'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Info } from 'lucide-react';

/**
 * A `Card` whose body folds away on a phone.
 *
 * Same surface, same header, one difference: below `md` the header is a disclosure button and
 * the body can be closed. A panel that is a compact strip on a desktop — the R-strip is the
 * case this was built for — becomes a thirty-row list on a phone, and a list that long pushes
 * everything under it off the screen. Folding it puts the rest of the dashboard back within a
 * thumb's reach without taking the detail away from anyone who wants it.
 *
 * The toggle exists only where it does something. On a wide screen the body is always open, so
 * a control there would be a button that changes nothing — the two headers are rendered
 * separately rather than one header switching behaviour, so the desktop header is plain markup
 * and the phone's is a real `button` with `aria-expanded`. Its accessible name is the card's
 * own title, which is the standard disclosure pattern and needs no string of its own.
 *
 * The body is hidden with `hidden md:block` rather than unmounted: the content is server-
 * rendered and handed in as a node, so keeping it in the tree costs nothing, and it means
 * turning a phone sideways into the wide layout shows the panel rather than an empty card.
 * `defaultOpen` is therefore the phone's starting state only — a card that starts closed still
 * renders open on a wide screen, where there is no way to open it.
 *
 * Whether it was left open is not remembered between visits. It is a per-glance thing — "I
 * have read the days, let me see the rest" — not a preference, and remembering it would mean
 * either a flash of the wrong state on every load or a round trip to store it.
 */
export function CollapsibleCard({
  title,
  action,
  children,
  defaultOpen = true,
  pad = true,
  info,
  infoLabel,
  className = '',
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  pad?: boolean;
  /** The same explanation `Card` takes — see `info-layer.tsx`. */
  info?: string;
  infoLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={`border-line bg-surface rounded-[18px] border ${className}`}>
      {/* ---------- Wide: the plain header, as `Card` draws it ---------- */}
      <div className="hidden items-center justify-between gap-2 px-4 pt-2.5 pb-1 md:flex">
        <div className={`${HEADING} flex min-w-0 items-center gap-1`}>
          <span className="min-w-0">{title}</span>
          {info ? <InfoMark info={info} label={infoLabel} title={title} /> : null}
        </div>
        {action}
      </div>

      {/* ---------- Narrow: the same header, as the disclosure ---------- */}
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        aria-expanded={open}
        aria-controls={bodyId}
        // The whole row is the target, not just the chevron — the header is already the width
        // of the card and a thumb aimed at a 16px glyph misses.
        // Closed, the row is the whole card, so it takes the body's bottom padding with it.
        className={`flex w-full items-center justify-between gap-2 px-4 pt-2.5 text-start md:hidden ${
          open ? 'pb-1' : 'pb-2.5'
        }`}
      >
        <span className={HEADING}>{title}</span>
        <span className="flex items-center gap-1.5">
          {action}
          <ChevronDown
            size={16}
            aria-hidden
            className={`text-dim shrink-0 transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      <div
        id={bodyId}
        className={`${pad ? 'px-4 pt-1 pb-3' : ''} ${open ? '' : 'hidden md:block'}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Kept in step with `Card`'s heading by hand — the two headers have to look identical. */
const HEADING = 'text-dim text-xs font-semibold tracking-[0.3px]';

/**
 * The explanation mark, drawn inside the wide header only.
 *
 * Not in the phone's header, and that is the whole reason this is a separate function rather
 * than the same markup twice. On a phone the header *is* the disclosure button, and a button
 * inside a button is invalid HTML that browsers repair by taking the inner one out — so the
 * mark would either vanish or, worse, swallow the tap that was meant to open the card. The
 * explanation is not lost: opening the card shows the same figures the mark describes, and
 * the mark is there the moment the screen is wide enough to have room for both.
 */
function InfoMark({ info, label, title }: { info: string; label?: string; title: ReactNode }) {
  return (
    <button
      type="button"
      data-info={info}
      aria-label={label ?? (typeof title === 'string' ? title : '')}
      className="text-dim/50 hover:text-text focus-visible:text-text -m-1 shrink-0 p-1 leading-none"
    >
      <Info size={12} aria-hidden />
    </button>
  );
}
