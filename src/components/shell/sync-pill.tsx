'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { refreshSyncAction } from '@/app/(app)/settings/mt5-actions';

export type SyncPillLabels = {
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
 * The prototype's header pill, doing the job it only mimed.
 *
 * SPEC §3.3 asks for a sync on every login plus a manual refresh button. Doing the login one
 * inside `signInAction` would mean a first-time user stares at a submit button while an
 * entire account history is backfilled. Instead the pill fires it from the client once the
 * dashboard is already on screen — the same "syncing…" state the prototype showed, except
 * the data really is arriving.
 *
 * `autoSyncDue` is computed on the server as "the user has logged in more recently than the
 * last successful sync", so it is true exactly once per login rather than on every
 * navigation.
 */
export function SyncPill({
  labels,
  connected,
  lastSyncedAt,
  autoSyncDue,
}: {
  labels: SyncPillLabels;
  connected: boolean;
  /** Preformatted on the server, so the markup does not depend on the client's locale. */
  lastSyncedAt: string | null;
  autoSyncDue: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [, startTransition] = useTransition();
  const autoSyncFired = useRef(false);

  const run = (automatic: boolean) => {
    setStatus('syncing');
    void refreshSyncAction(automatic)
      .then((result) => {
        if (result.status === 'error') setStatus('failed');
        else if (result.status === 'rate-limited') setStatus('rate-limited');
        else setStatus('idle');
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

  const syncing = status === 'syncing';

  const label = !connected
    ? labels.notConnected
    : syncing
      ? labels.syncing
      : status === 'failed'
        ? labels.failed
        : status === 'rate-limited'
          ? labels.tooSoon
          : lastSyncedAt
            ? `${labels.synced} · ${lastSyncedAt}`
            : labels.never;

  const tone = syncing
    ? 'text-warn'
    : status === 'failed'
      ? 'text-neg'
      : connected
        ? 'text-pos'
        : 'text-dim';

  return (
    <button
      type="button"
      onClick={() => connected && !syncing && run(false)}
      disabled={!connected || syncing}
      title={labels.refresh}
      aria-label={labels.refresh}
      aria-busy={syncing}
      className={`border-line bg-raised flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone} disabled:cursor-default`}
    >
      <RefreshCw size={13} className={syncing ? 'tri-spin' : ''} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
