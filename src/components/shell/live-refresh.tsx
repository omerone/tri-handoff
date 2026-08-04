'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps an open tab showing current numbers without anyone pressing reload.
 *
 * Server actions already redraw the page they were fired from — `revalidatePath` plus the
 * action response is enough for anything the user types. What they cannot cover is data that
 * changes with no interaction in this browser: the quote ticker in `instrumentation-node.ts`
 * marks long positions to market every 60s, an MT5 sync brings in trades, and the same
 * account may be open on a phone at the same time. Before this, none of that reached a tab
 * that was already open — measured at zero network requests over 65 idle seconds.
 *
 * `router.refresh()` re-fetches the current route's server components and reconciles them
 * into the existing tree. Client state survives it, so a half-typed form is not disturbed;
 * this is deliberately not a `location.reload()`.
 *
 * Two triggers, and the split matters:
 *
 *   - **Coming back to the tab.** Refresh on focus and on becoming visible. This is where
 *     nearly all of the value is: what people actually notice is switching back after ten
 *     minutes elsewhere and being shown ten-minute-old numbers.
 *   - **A timer, only while visible.** Bounded staleness for a tab left in the foreground.
 *     Hidden tabs are skipped entirely, so a browser holding twenty background tabs does not
 *     cost twenty server renders a minute.
 *
 * The interval matches the quote ticker: refreshing faster cannot surface anything newer,
 * it only spends renders.
 */

const REFRESH_INTERVAL_MS = 60_000;

/** Ignore a wake-up that lands right after a refresh — focus and visibility often both fire. */
const MIN_GAP_MS = 5_000;

export function LiveRefresh() {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = now;
      router.refresh();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_INTERVAL_MS);

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
