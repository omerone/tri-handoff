'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The explanation behind the small `i` beside a figure.
 *
 * Separate from `tooltip.tsx` on purpose, and not a longer `data-tip`. A hint names a control
 * you are already pointing at, so it appears on hover, after 90ms, and leaves the moment the
 * pointer does. This answers "what is a profit factor, and what counts as a good one" — three
 * or four sentences somebody stops to read, which a bubble that vanishes when the mouse drifts
 * cannot hold. Different question, different lifetime, different trigger: click, and it stays
 * until dismissed.
 *
 * One listener on the document, like the hint layer, so a figure can carry an explanation from
 * a server component without a client boundary around every tile. `data-info` on the button is
 * the whole API.
 *
 * The text is deliberately plain rather than markup: an explanation of a number belongs in the
 * message catalogue where a translator can see it whole, and letting it carry HTML would mean
 * every locale file is a place someone can inject a tag.
 */

/** The gap between the button and the panel, and its minimum distance to a viewport edge. */
const OFFSET = 8;
const EDGE = 8;

type Anchor = { text: string; label: string; rect: DOMRect };

export function InfoLayer() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const close = (returnFocus = false) => {
      if (returnFocus) opener.current?.focus?.();
      opener.current = null;
      setAnchor(null);
      setPos(null);
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;

      // A click inside the panel is someone selecting the text to re-read it, not a dismissal.
      if (target?.closest?.('[data-info-panel]')) return;

      const button = target?.closest?.('[data-info]') as HTMLElement | null;
      if (!button) return close();

      // The same button again closes it. Without this the only way out of an explanation you
      // opened by accident is to find somewhere else to click.
      if (button === opener.current) return close(true);

      const text = button.getAttribute('data-info')?.trim();
      if (!text) return close();

      opener.current = button;
      setPos(null);
      setAnchor({
        text,
        label: button.getAttribute('aria-label') ?? '',
        rect: button.getBoundingClientRect(),
      });
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    // Capture, because a scroll inside a table does not bubble and the rect this was measured
    // from is stale the moment anything moves.
    window.addEventListener('scroll', () => close(), true);
    window.addEventListener('resize', () => close());

    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  /*
   * Measured, then placed. The panel's width depends on its sentences and on the locale, so
   * there is no honest way to centre or clamp it from the button alone — it renders hidden,
   * gets measured, and only then takes a position.
   */
  useLayoutEffect(() => {
    if (!anchor || !panel.current) return;
    const box = panel.current.getBoundingClientRect();
    const { rect } = anchor;

    // Below by preference — the figure it explains is above it and should stay visible. Above
    // when there is no room, which is what happens at the bottom of a long page.
    const below = rect.bottom + OFFSET;
    const top =
      below + box.height <= window.innerHeight - EDGE
        ? below
        : Math.max(EDGE, rect.top - box.height - OFFSET);

    const centred = rect.left + rect.width / 2 - box.width / 2;
    const max = Math.max(EDGE, window.innerWidth - box.width - EDGE);
    setPos({ left: Math.min(Math.max(centred, EDGE), max), top });
  }, [anchor]);

  // Focus the panel once it is placed, so Escape reaches it and a screen reader is taken to
  // the answer rather than left on the button that asked for it.
  useEffect(() => {
    if (pos && panel.current) panel.current.focus();
  }, [pos]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !anchor) return null;

  return createPortal(
    <div
      ref={panel}
      data-info-panel=""
      role="dialog"
      aria-label={anchor.label}
      tabIndex={-1}
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 60,
        width: 'min(22rem, calc(100vw - 16px))',
      }}
      className="border-line bg-raised text-text animate-[tri-tip_120ms_ease-out] rounded-[14px] border p-3 text-xs leading-relaxed shadow-xl outline-none"
    >
      {anchor.label ? <div className="mb-1 text-[11px] font-semibold">{anchor.label}</div> : null}
      <p className="text-dim">{anchor.text}</p>
    </div>,
    document.body,
  );
}
