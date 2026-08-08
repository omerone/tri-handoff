'use client';

import { useEffect, useRef } from 'react';

/**
 * A soft light that follows the pointer across the whole app.
 *
 * It is the one piece of the Depth language that cannot be done in CSS alone, and it is
 * deliberately the only thing on the page that runs code on an input event. Three decisions
 * keep that from costing anything:
 *
 * **It moves a finished layer.** The obvious build recentres a radial gradient on every
 * mouse move — `background: radial-gradient(circle at Xpx Ypx, …)` — which repaints the
 * element each frame. This one paints the blob once and then only writes `transform`, which
 * the compositor applies on the GPU without touching layout or paint.
 *
 * **It writes at most once per frame.** A pointer can fire well above 60 events a second on
 * a high-polling mouse; the rAF gate collapses whatever arrives into a single write per
 * frame, so a fast trackpad flick costs the same as a slow one.
 *
 * **It does not exist where it makes no sense.** With no hover-capable pointer there is
 * nothing to follow, and a reader who has asked their system for less movement should not be
 * given a light that chases them. In both cases the listener is never attached and the CSS
 * takes the element out of the page entirely.
 *
 * No props, so nothing has to cross the server/client boundary to render it.
 */
export function PointerGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia('(hover: hover)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let queued = false;
    let x = 0;
    let y = 0;

    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.dataset.lit = '1';
        queued = false;
      });
    };

    // Fades out rather than freezing in the last place the pointer was seen.
    const onLeave = () => {
      el.dataset.lit = '0';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <div ref={ref} className="tri-glow" aria-hidden />;
}
