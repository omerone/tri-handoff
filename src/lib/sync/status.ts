/**
 * Two decisions the sync pill needs, as arithmetic rather than as JSX.
 *
 * Both used to live inline in a server component, where they could only be checked by loading
 * a page — and both are the kind of condition that is wrong in one branch out of five and
 * looks fine on the branch you happen to test by hand. One of them decides whether money is
 * spent without anyone pressing anything, which is reason enough to be able to state it as a
 * table of cases.
 *
 * Pure: no clock of its own, no database, no `Date.now()`. The caller passes the instant.
 */

/**
 * Beyond this, the pill reports how long ago the last sync was instead of the time of day.
 *
 * Twelve hours: long enough that a normal trading day never trips it, short enough that
 * yesterday's numbers announce themselves as yesterday's.
 */
export const STALE_AFTER_HOURS = 12;

export type SyncStatusInputs = {
  /** Null when no broker account is connected. */
  lastSyncAt: Date | null;
  /** Null when the account has never been connected. */
  connected: boolean;
  lastLoginAt: Date | null;
  /** The trader's own setting. Off by default — see the column comment in the schema. */
  autoSyncOnLogin: boolean;
  now: Date;
};

/**
 * Whether this page load should pull from the broker on its own.
 *
 * Four conditions, and the order they are written in is the order they matter:
 *
 *   1. **the setting** — off by default, and off means no unrequested call ever, whatever the
 *      timestamps say. This is the whole cost saving;
 *   2. **a connected account** — nothing to sync from otherwise;
 *   3. **never synced** — a freshly connected account has a whole history to fetch;
 *   4. **logged in since the last sync** — this is what makes it "once per login" rather than
 *      once per navigation. Without it every page view would re-fire.
 *
 * A null `lastLoginAt` returns false rather than true. The stamp is written at sign-in, so
 * its absence means we cannot tell when the session began — and the safe direction for a
 * question about spending money is "do not".
 */
export function isAutoSyncDue(inputs: SyncStatusInputs): boolean {
  if (!inputs.autoSyncOnLogin) return false;
  if (!inputs.connected) return false;
  if (inputs.lastSyncAt === null) return true;
  if (inputs.lastLoginAt === null) return false;
  return inputs.lastLoginAt.getTime() > inputs.lastSyncAt.getTime();
}

/**
 * Whole hours since the last successful sync, once that is worth saying out loud.
 *
 * Null below the threshold, and null when there has never been a sync — the pill says "never
 * synced" for that, which is a different and clearer sentence than "synced 0 hours ago".
 *
 * A negative age means the stored timestamp is in the future, which happens when a server's
 * clock is corrected backwards. It reads as fresh rather than as a nonsense like "-3h ago".
 */
export function staleHours(inputs: Pick<SyncStatusInputs, 'lastSyncAt' | 'now'>): number | null {
  if (inputs.lastSyncAt === null) return null;

  const hours = Math.floor(
    (inputs.now.getTime() - inputs.lastSyncAt.getTime()) / 3_600_000,
  );
  return hours >= STALE_AFTER_HOURS ? hours : null;
}
