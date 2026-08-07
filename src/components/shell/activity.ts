'use client';

/**
 * When this person last did something, shared by every tab of the app.
 *
 * Two features read it and they have to agree. `SessionExpiry` signs a forgotten tab out an
 * hour after the last thing anyone did; `LiveRefresh` stops polling long before that, so a
 * forgotten tab is not quietly holding its own session open by asking the server for a
 * redraw once a minute. Two separate notions of "idle" would mean the poller keeping the
 * session alive right up to the moment the watcher threw it away.
 *
 * `localStorage`, not a module variable, because the unit is the person and not the tab.
 * Somebody reading their book in one tab while a dashboard sits open in another is not idle,
 * and the server — which sees requests, not tabs — would not have signed them out either.
 *
 * Failures are swallowed and read as "just now". Storage throws in a handful of real
 * situations (Safari's private mode historically, a full quota, a locked-down profile), and
 * none of them are a reason to sign somebody out mid-sentence. The database is the authority
 * on when a session ends; everything here is so the screen can say it first.
 */

const KEY = 'tri:last-activity';

/** Events that mean a person, rather than a timer or a background fetch. */
const SIGNALS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Don't write to storage on every pixel of a scroll. */
const WRITE_EVERY_MS = 5_000;

let lastWrite = 0;

/**
 * When this tab loaded, and the answer for a browser that has stored nothing yet.
 *
 * Arriving on a page is something a person did, so the clock starts here rather than at zero.
 * It must not start at *now* on every read: that was the first version, and it meant a tab
 * that was opened and then never touched reported itself as busy forever — the poller kept
 * asking, each ask renewed the session, and the hour never began. Reading a page without
 * scrolling it is exactly the case that has to expire.
 */
const loadedAt = Date.now();

export function markActivity(now: number = Date.now()): void {
  if (now - lastWrite < WRITE_EVERY_MS) return;
  lastWrite = now;
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // See above: an unwritable store is not a reason to end a session.
  }
}

/**
 * The last moment anyone did something, in epoch milliseconds.
 *
 * The stored value wins outright. Clamping it to `loadedAt` was the first version — the idea
 * being that arriving on a page cannot be older than the page — and it made the stamp
 * unreachable: no reading could ever be older than this tab, so the clock reset on every
 * navigation and the deadline could not be reached at all. `watchActivity` writing on mount
 * is what actually covers a fresh browser; `loadedAt` is only for a store that will not read.
 */
export function lastActivityAt(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : loadedAt;
  } catch {
    return loadedAt;
  }
}

/**
 * Watch for activity until the component unmounts.
 *
 * `capture` so a handler that stops propagation — the dialogs in this app do, to keep Escape
 * from closing two things at once — cannot make the person look idle while they are typing
 * into it. Passive, because none of these ever call `preventDefault` and a non-passive
 * scroll listener blocks the compositor on a phone.
 */
export function watchActivity(onActivity: () => void = () => markActivity()): () => void {
  /*
   * Opening the page counts, and it has to.
   *
   * The render that produced it went through `getSession`, which pushed the server's idle
   * window out — so a tab that did not stamp anything here would run a clock an hour behind
   * the one that actually decides, and would sign out a session the database still considers
   * live. It also settles the two-tab case: a second tab opened at half past is activity for
   * the first one too, because there is one person and one stamp.
   */
  markActivity();

  const handler = () => {
    markActivity();
    onActivity();
  };
  for (const signal of SIGNALS) {
    window.addEventListener(signal, handler, { capture: true, passive: true });
  }
  return () => {
    for (const signal of SIGNALS) {
      window.removeEventListener(signal, handler, { capture: true });
    }
  };
}
