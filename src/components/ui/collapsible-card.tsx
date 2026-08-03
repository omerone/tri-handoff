'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

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
  className = '',
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <div className={`border-line bg-surface rounded-[18px] border ${className}`}>
      {/* ---------- Wide: the plain header, as `Card` draws it ---------- */}
      <div className="hidden items-center justify-between gap-2 px-4 pt-3 pb-1 md:flex">
        <div className={HEADING}>{title}</div>
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
        className={`flex w-full items-center justify-between gap-2 px-4 pt-3 text-start md:hidden ${
          open ? 'pb-1' : 'pb-3'
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

      <div id={bodyId} className={`px-4 pt-1 pb-4 ${open ? '' : 'hidden md:block'}`}>
        {children}
      </div>
    </div>
  );
}

/** Kept in step with `Card`'s heading by hand — the two headers have to look identical. */
const HEADING = 'text-dim text-xs font-semibold tracking-[0.3px]';
