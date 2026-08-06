'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { refreshSyncAction } from '@/app/(app)/settings/mt5-actions';

export type SyncPillLabels = {
  /** While the terminal is being woken — a cold start takes about a minute. */
  connecting: string;
  /** Idle, which is now the honest word for it: the broker link is down between syncs. */
  disconnected: string;
  syncing: string;
  synced: string;
  refresh: string;
  never: string;
  failed: string;
  notConnected: string;
  tooSoon: string;
};

type Status = 'idle' | 'syncing' | 'failed' | 'rate-limited';

/**
 * The header pill: the one control that spends money, and the report on what it bought.
 *
 * SPEC §3.3 asked for a sync on every login plus a manual refresh button. The login half is
 * now behind a setting that is off by default — see `sync-status.tsx` — so in the normal case
 * this button is the only thing that reaches the broker at all. That makes two things worth
 * showing that were not before:
 *
 *   - **What the last press pulled.** A refresh that imported nothing and one that imported
 *     forty look identical if all you show is a timestamp, and on a metered connection the
 *     difference is the whole question of whether pressing again is worth it.
 *   - **How stale the data is.** With nothing refreshing on its own, "synced · 09:14" is
 *     silent about 09:14 being two days ago. Past a threshold the pill says the age instead.
 *
 * `autoSyncDue` is computed on the server as "the setting is on *and* the user has logged in
 * more recently than the last successful sync", so it is true at most once per login rather
 * than on every navigation.
 *
 * **Idle is grey and says "disconnected", because that is what is true.** The sync hands the
 * broker terminal back when it finishes — MetaApi charges by the hour it runs — so between
 * presses there is no live connection at all, only stored credentials. The pill used to sit
 * green on the strength of those credentials, describing a link that was not up. It reads as
 * a clock with a button on it now: grey and the time of the last successful read, amber while
 * it wakes the terminal and pulls, green for the receipt, then grey again with a newer time.
 */

/** How long the "3 new · 1 updated" note stays up before the pill goes back to normal. */
const OUTCOME_MS = 20_000;

/**
 * How long a sync is described as waking the terminal before it is described as syncing.
 *
 * Measured against the real thing rather than guessed: a cold MetaApi account answers "not
 * connected to broker yet" for roughly a minute before it will serve anything. Forty-five
 * seconds is inside that, so the label changes while the wait is still plausibly provisioning
 * and never claims to be connecting long after it must have been.
 */
const WAKING_MS = 45_000;

export function SyncPill({
  labels,
  connected,
  lastSyncedAt,
  autoSyncDue,
  staleLabel,
}: {
  labels: SyncPillLabels;
  connected: boolean;
  /** Preformatted on the server, so the markup does not depend on the client's locale. */
  lastSyncedAt: string | null;
  autoSyncDue: boolean;
  /**
   * "Synced 38h ago", already translated, or null while the data is not old enough to say
   * so. The threshold and the arithmetic are the server's — see `sync-status.tsx`, which also
   * explains why this is not computed from the browser's clock.
   */
  staleLabel: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const autoSyncFired = useRef(false);
  /*
   * Whether the pill is still in the part of a sync that is spent waking the terminal.
   *
   * The server action is one call, so the client cannot be told when provisioning ends and
   * reading begins. It does not need to be told precisely — the point is to set the right
   * expectation for a wait that is normally about a minute, rather than showing "syncing"
   * for sixty seconds during which nothing is being synced yet.
   */
  const [waking, setWaking] = useState(false);

  const run = (automatic: boolean) => {
    setStatus('syncing');
    setOutcome(null);
    setWaking(true);
    void refreshSyncAction(automatic)
      .then((result) => {
        if (result.status === 'error') setStatus('failed');
        else if (result.status === 'rate-limited') setStatus('rate-limited');
        else {
          setStatus('idle');
          /*
           * Only for a press. An automatic sync happens while the trader is looking at the
           * dashboard for the first time, and "0 new" as the first thing they read is noise
           * about a thing they did not ask for.
           */
          if (!automatic && result.status === 'success') setOutcome(result.note);
        }
        // Pull the freshly synced numbers into the page without a full reload.
        startTransition(() => router.refresh());
      })
      .catch(() => setStatus('failed'));
  };

  useEffect(() => {
    // The ref guard matters under React strict mode, which mounts effects twice in
    // development — without it the first login would fire two backfills.
    if (!connected || !autoSyncDue || autoSyncFired.current) return;
    autoSyncFired.current = true;
    run(true);
    // Intentionally runs once per mount; `run` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoSyncDue]);

  useEffect(() => {
    if (!waking) return;
    const timer = setTimeout(() => setWaking(false), WAKING_MS);
    return () => clearTimeout(timer);
  }, [waking]);

  // The outcome is a receipt, not a state — it fades so the pill goes back to being a clock.
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => setOutcome(null), OUTCOME_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const syncing = status === 'syncing';
  const stale = staleLabel !== null;

  const label = !connected
    ? labels.notConnected
    : syncing
      ? // A cold start spends its first minute waiting for MetaApi to bring the terminal up and
        // connect it to the broker, so "syncing" is wrong for the part of the wait a trader
        // actually sits through. This flips once that phase is plausibly over.
        waking
        ? labels.connecting
        : labels.syncing
      : status === 'failed'
        ? labels.failed
        : status === 'rate-limited'
          ? labels.tooSoon
          : outcome !== null
            ? outcome
            : stale
              ? staleLabel
              : lastSyncedAt
                ? labels.disconnected
                : labels.never;

  // The clock is redundant next to a receipt or an age, and all three at once is a pill that
  // wraps onto two lines on a phone.
  const showTime =
    connected && !syncing && status === 'idle' && outcome === null && !stale && lastSyncedAt !== null;

  /*
   * Green is reserved for the moment it worked.
   *
   * Idle is grey because idle *is* disconnected now, and a pill that goes green whenever an
   * account exists tells a trader the broker is live when the terminal has been stopped for
   * days. The receipt — "3 new · 1 updated" — is the one thing worth colouring, and it fades
   * back to grey on its own.
   */
  const tone = syncing
    ? 'text-warn'
    : status === 'failed'
      ? 'text-neg'
      : !connected
        ? 'text-dim'
        : outcome !== null
          ? 'text-pos'
          : stale
            ? 'text-warn'
            : 'text-dim';

  return (
    <button
      type="button"
      onClick={() => connected && !syncing && run(false)}
      disabled={!connected || syncing}
      data-tip={labels.refresh}
      aria-label={labels.refresh}
      aria-busy={syncing}
      className={`border-line bg-raised flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone} disabled:cursor-default`}
    >
      <RefreshCw size={13} className={syncing ? 'tri-spin' : ''} aria-hidden />
      <span className="hidden sm:inline">
        {label}
        {/* The time is its own LTR run: in Hebrew a bare "01:40" appended to RTL text has
            its colon and digits reordered, and the pill ends up reading backwards. */}
        {showTime ? (
          <>
            {' · '}
            <span dir="ltr" className="tri-num">
              {lastSyncedAt}
            </span>
          </>
        ) : null}
      </span>
    </button>
  );
}
