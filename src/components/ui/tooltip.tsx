'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The hover hint on every icon button in the product.
 *
 * This replaces the `title` attribute, which is not a design decision anyone made — it is
 * the browser's own tooltip, and its delay is a browser preference no page can reach. On
 * macOS it is well over a second: long enough that a trader hovering a bare trash icon in a
 * table of rows lets go and clicks without ever finding out which one it deletes. There is
 * no CSS property, no attribute and no JavaScript hook that shortens it. The only way to
 * control when the hint appears is to stop using the native one.
 *
 * One listener on the document rather than a wrapper component per button. Every hint in the
 * product is `data-tip` on the control itself, so a server component can carry one without a
 * client boundary around it, and adding a hint to a new button is one attribute rather than
 * an import and a wrapper. It also means this is the only place the delay is written down.
 *
 * The hint is never the accessible name. Every control that carries `data-tip` also carries
 * `aria-label` or visible text, and this bubble is `aria-hidden`, so a screen reader hears
 * the label once from the control rather than twice from two sources that can drift apart.
 */

/** Long enough not to flash while the cursor crosses a toolbar, short enough to feel instant. */
const OPEN_DELAY_MS = 90;

/** The gap between the control and the bubble, and the bubble's minimum distance to an edge. */
const OFFSET = 8;
const EDGE = 8;

type Anchor = { text: string; rect: DOMRect };

export function TooltipLayer() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  // Kept outside state: a pending timer is not something the bubble renders, and putting it
  // in state would re-render the whole layer on every mouseover in the app.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Element | null>(null);
  // The control the pointer is resting on after pressing it — see `onDown`.
  const pressed = useRef<Element | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const hide = () => {
      cancel();
      current.current = null;
      setAnchor(null);
      setPos(null);
    };

    const show = (el: Element, delay: number) => {
      const text = el.getAttribute('data-tip')?.trim();
      if (!text) return;
      cancel();
      current.current = el;
      timer.current = setTimeout(() => {
        // The control can be gone by the time the timer fires — a row deleted, a form
        // swapped for its editing state — and a bubble measured against a detached element
        // would land in the corner of the screen.
        if (!el.isConnected) return hide();
        setPos(null);
        setAnchor({ text, rect: el.getBoundingClientRect() });
      }, delay);
    };

    const onOver = (event: PointerEvent) => {
      // Touch and pen raise pointerover on tap, where a hint that appears under the finger
      // and stays there is noise. Those users get the button's own label, not a hover state.
      if (event.pointerType !== 'mouse') return;
      if (pressed.current && !pressed.current.isConnected) pressed.current = null;
      const el = (event.target as Element | null)?.closest?.('[data-tip]');
      if (!el) return hide();
      // A button that changes when pressed — the sync pill starting to spin, a row redrawn by
      // a server action — replaces what is under the cursor, and the browser raises a fresh
      // `pointerover` for it. Without this the hint reappears a moment after every click,
      // over a control the user has already read and acted on.
      if (el === pressed.current) return;
      if (el === current.current) return;
      show(el, OPEN_DELAY_MS);
    };

    const onOut = (event: PointerEvent) => {
      const from = (event.target as Element | null)?.closest?.('[data-tip]');
      const to = event.relatedTarget as Node | null;
      // Moving within the control — over the icon inside the button — is not leaving it.
      const left = from && !(to && from.contains(to));
      if (left && from === pressed.current) pressed.current = null;
      if (!current.current) return;
      if (to && current.current.contains(to)) return;
      hide();
    };

    // On press, because clicking a delete button removes the row it sat in and no pointerout
    // ever arrives — the bubble would be left pointing at a gap.
    const onDown = (event: PointerEvent) => {
      pressed.current = (event.target as Element | null)?.closest?.('[data-tip]') ?? null;
      hide();
    };

    // Keyboard focus shows the hint at once: someone tabbing to a control has already chosen
    // it, so there is no sweep to protect against and nothing to wait for.
    const onFocus = (event: FocusEvent) => {
      const el = (event.target as Element | null)?.closest?.('[data-tip]');
      if (el) show(el, 0);
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    // Capture: a scroll inside a table does not bubble, and the rect this was measured from
    // is stale the moment anything moves.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);

    return () => {
      cancel();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  /*
   * Placed after measuring, not before: the bubble's width depends on its text and on the
   * locale, so there is no honest way to centre or clamp it from the anchor alone. It renders
   * once hidden, gets measured, and only then takes a position — which is also why `pos` is
   * cleared whenever the anchor changes.
   */
  useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;
    const box = bubble.current.getBoundingClientRect();
    const { rect } = anchor;

    // Above by preference — a bubble below the cursor's own control sits under the pointer.
    // Below when there is no room, which is what happens along the top header.
    const above = rect.top - box.height - OFFSET;
    const top = above >= EDGE ? above : rect.bottom + OFFSET;

    const centred = rect.left + rect.width / 2 - box.width / 2;
    const max = Math.max(EDGE, window.innerWidth - box.width - EDGE);
    setPos({ left: Math.min(Math.max(centred, EDGE), max), top });
  }, [anchor]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !anchor) return null;

  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      // The product's own hint, distinct from the ones Recharts draws: a dashboard carries
      // thirty-odd `role="tooltip"` nodes for its charts, so the role alone identifies nothing.
      data-tri-tip=""
      aria-hidden
      // Fixed to the viewport rather than to a positioned parent, so a hint on a control
      // inside a scrolling table or an `overflow-hidden` card is not clipped by it.
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        // Hidden rather than unmounted for the one frame it takes to measure: `visibility`
        // still gives the element a box, which `display: none` would not.
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 60,
        pointerEvents: 'none',
        maxWidth: 'min(20rem, calc(100vw - 16px))',
      }}
      className="border-line bg-raised text-text animate-[tri-tip_120ms_ease-out] rounded-lg border px-2 py-1 text-xs leading-snug font-medium shadow-lg"
    >
      {anchor.text}
    </div>,
    document.body,
  );
}
