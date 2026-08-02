import { getTranslations } from 'next-intl/server';
import { getMt5Account } from '@/lib/db';
import type { TenantSession } from '@/lib/tenant/context';
import { SyncPill } from './sync-pill';
import { formatTimeAt } from '@/lib/time/format';

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

  // "Sync on every login": true from the moment of a login until a sync completes, and false
  // for every navigation after that.
  const autoSyncDue =
    account !== null &&
    (account.lastSyncAt === null ||
      (lastLoginAt !== null && lastLoginAt.getTime() > account.lastSyncAt.getTime()));

  // A time only — the pill means "synced today at", and a date here would push the header
  // wider on a phone for information the settings page already carries in full.
  const lastSyncedAt = account?.lastSyncAt ? formatTimeAt(account.lastSyncAt) : null;

  return (
    <SyncPill
      connected={account !== null}
      lastSyncedAt={lastSyncedAt}
      autoSyncDue={autoSyncDue}
      labels={{
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
