'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { lastActivityAt, watchActivity } from './activity';

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
 *   - **A timer, only while visible *and* while somebody is there.** Bounded staleness for a
 *     tab being worked in. Hidden tabs are skipped entirely, so a browser holding twenty
 *     background tabs does not cost twenty server renders a minute.
 *
 * The interval matches the quote ticker: refreshing faster cannot surface anything newer,
 * it only spends renders.
 */

const REFRESH_INTERVAL_MS = 60_000;

/** Ignore a wake-up that lands right after a refresh — focus and visibility often both fire. */
const MIN_GAP_MS = 5_000;

/**
 * How long the tab keeps polling after the last thing anyone did.
 *
 * The session now ends after an hour of inactivity, and every request made by this component
 * pushes that hour out again — so a forgotten tab left open on a desk would poll all night
 * and keep its own session alive forever, which is precisely the thing the hour exists to
 * stop. Two minutes is long enough that a pause to read a chart is not a pause at all, and
 * short enough that the session's clock starts almost as soon as the person stops.
 *
 * Nothing is lost by stopping: coming back to the tab refreshes it on focus, which is where
 * nearly all of this component's value was to begin with.
 */
const POLL_WHILE_ACTIVE_MS = 2 * 60_000;

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
      if (document.visibilityState !== 'visible') return;
      // A tab nobody is using stops asking. See POLL_WHILE_ACTIVE_MS: each of these requests
      // renews the session, so polling into the night would defeat the idle window entirely.
      if (Date.now() - lastActivityAt() > POLL_WHILE_ACTIVE_MS) return;
      refresh();
    }, REFRESH_INTERVAL_MS);

    // Coming back to a tab after a break is activity — and it is also the moment the numbers
    // most need to be current, so the refresh below is the one that matters most.
    const stopWatching = watchActivity();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      stopWatching();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
