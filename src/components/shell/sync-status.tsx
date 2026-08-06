import { getTranslations } from 'next-intl/server';
import { getMt5Account } from '@/lib/db';
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
  const account = await getMt5Account(session.ctx);

  /*
   * Both decisions are arithmetic and live in `lib/sync/status.ts`, where they are exercised
   * as a table of cases rather than by loading this page. One of them decides whether money
   * is spent without anyone pressing anything, and it is off by default: on a metered
   * provider two visits a day is fourteen broker round trips a week that nobody asked for.
   */
  const now = new Date();
  const status: SyncStatusInputs = {
    lastSyncAt: account?.lastSyncAt ?? null,
    connected: account !== null,
    lastLoginAt,
    autoSyncOnLogin: session.user.autoSyncOnLogin,
    now,
  };

  // A time only — the pill means "synced today at", and a date here would push the header
  // wider on a phone for information the settings page already carries in full.
  const lastSyncedAt = account?.lastSyncAt ? formatTimeAt(account.lastSyncAt) : null;

  /*
   * Formatted here rather than in the pill: `Date.now()` on the client is the *browser's*
   * clock, which can be wrong by hours, and the message has a placeholder that belongs to
   * next-intl rather than to a `.replace()` on the other side of the boundary.
   */
  const hours = staleHours(status);
  const staleLabel = hours === null ? null : t('stale', { hours });

  return (
    <SyncPill
      connected={account !== null}
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
