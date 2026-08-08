import { getTranslations } from 'next-intl/server';
import { listMt5Accounts } from '@/lib/db';
import type { TenantSession } from '@/lib/tenant/context';
import { SyncPill } from './sync-pill';
import { formatTimeAt } from '@/lib/time/format';
import { isAutoSyncDue, staleHours, type SyncStatusInputs } from '@/lib/sync/status';

/**
 * Server half of the sync pill: reads the account, decides whether a login-triggered sync is
 * owed, and formats the timestamp so the markup does not depend on the browser's locale.
 */
export async function SyncStatus({
  session,
  lastLoginAt,
}: {
  session: TenantSession;
  lastLoginAt: Date | null;
}) {
  const t = await getTranslations('sync');
  const accounts = await listMt5Accounts(session.ctx);

  /*
   * The *oldest* of the connected accounts' syncs, not the first account's.
   *
   * This pill is one sentence about the whole book, so it has to describe the account that is
   * furthest behind: with two accounts connected, reading only the first one meant the header
   * could say "synced 20:39" while the other account had not been reached for a day, and the
   * screens below were mixing fresh figures with stale ones under a pill that said everything
   * was current. An account that has never synced at all is the oldest there is, so it makes
   * the whole thing read as never synced — which is exactly what it is.
   */
  const syncTimes = accounts.map((account) => account.lastSyncAt);
  const oldestSync = syncTimes.some((at) => at === null)
    ? null
    : syncTimes.reduce<Date | null>(
        (oldest, at) => (oldest === null || (at !== null && at < oldest) ? at : oldest),
        null,
      );

  /*
   * Both decisions are arithmetic and live in `lib/sync/status.ts`, where they are exercised
   * as a table of cases rather than by loading this page. One of them decides whether money
   * is spent without anyone pressing anything, and it is off by default: on a metered
   * provider two visits a day is fourteen broker round trips a week that nobody asked for.
   */
  const now = new Date();
  const status: SyncStatusInputs = {
    lastSyncAt: oldestSync,
    connected: accounts.length > 0,
    lastLoginAt,
    autoSyncOnLogin: session.user.autoSyncOnLogin,
    now,
  };

  // A time only — the pill means "synced today at", and a date here would push the header
  // wider on a phone for information the settings page already carries in full.
  const lastSyncedAt = oldestSync ? formatTimeAt(oldestSync) : null;

  /*
   * Formatted here rather than in the pill: `Date.now()` on the client is the *browser's*
   * clock, which can be wrong by hours, and the message has a placeholder that belongs to
   * next-intl rather than to a `.replace()` on the other side of the boundary.
   */
  const hours = staleHours(status);
  const staleLabel = hours === null ? null : t('stale', { hours });

  return (
    <SyncPill
      connected={accounts.length > 0}
      lastSyncedAt={lastSyncedAt}
      autoSyncDue={isAutoSyncDue(status)}
      staleLabel={staleLabel}
      labels={{
        connecting: t('connecting'),
        disconnected: t('disconnected'),
        syncing: t('syncing'),
        synced: t('synced'),
        refresh: t('refresh'),
        never: t('never'),
        failed: t('failed'),
        notConnected: t('notConnected'),
        tooSoon: t('tooSoon'),
      }}
    />
  );
}
