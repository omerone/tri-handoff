import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';
import { requireAdmin } from '@/lib/auth/admin-session';
import { getTenantDetail, tenantSyncLogs } from '@/lib/db/unscoped';
import { setTenantStatusAction } from '../actions';
import { DangerZone, EditTenantForm, SetPasswordForm } from './forms';
import { formatDateTimeAt } from '@/lib/time/format';

export const dynamic = 'force-dynamic';

/**
 * One client, everything about them.
 *
 * The three things an operator actually does here: fix a domain after a DNS change, set a
 * password for someone who cannot receive their reset email, and read the sync log to find
 * out why a client is seeing stale numbers.
 */
export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireAdmin();
  const { tenantId } = await params;

  const [tenant, logs] = await Promise.all([
    getTenantDetail(tenantId),
    tenantSyncLogs(tenantId, 25),
  ]);
  if (!tenant) notFound();

  const stamp = (date: Date | null) =>
    date ? formatDateTimeAt(date) : '—';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            aria-label="Back to clients"
            className="border-line bg-raised text-dim hover:text-text flex h-7 w-7 items-center justify-center rounded-lg border"
          >
            <ChevronLeft size={14} aria-hidden />
          </Link>
          <div>
            <h1 className="tri-num text-xl font-extrabold">{tenant.domain}</h1>
            <p className="text-dim text-xs">
              {tenant.name} · created {stamp(tenant.createdAt)}
            </p>
          </div>
        </div>

        <form action={setTenantStatusAction}>
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input
            type="hidden"
            name="status"
            value={tenant.status === 'active' ? 'suspended' : 'active'}
          />
          <button
            type="submit"
            className="border-line bg-raised rounded-lg border px-3 py-1.5 text-xs"
          >
            {tenant.status === 'active' ? 'Suspend' : 'Activate'}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Status" value={tenant.status} tone={tenant.status === 'active' ? 'pos' : 'neg'} />
        <KPI label="Trades" value={String(tenant.counts.trades)} />
        <KPI label="Finance entries" value={String(tenant.counts.financeEntries)} />
        <KPI label="Long positions" value={String(tenant.counts.longPositions)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Client">
          <dl className="grid grid-cols-2 gap-y-2 text-xs">
            <dt className="text-dim">Email</dt>
            <dd className="tri-num">{tenant.user?.email ?? '—'}</dd>
            <dt className="text-dim">Language</dt>
            <dd>{tenant.user?.locale ?? '—'}</dd>
            <dt className="text-dim">Display currency</dt>
            <dd>{tenant.user?.displayCurrency ?? '—'}</dd>
            <dt className="text-dim">Last login</dt>
            <dd className="tri-num">{stamp(tenant.user?.lastLoginAt ?? null)}</dd>
          </dl>
        </Card>

        <Card title="MT5 account">
          {tenant.mt5 ? (
            <dl className="grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-dim">Login</dt>
              <dd className="tri-num">{tenant.mt5.login}</dd>
              <dt className="text-dim">Server</dt>
              <dd className="tri-num">{tenant.mt5.server}</dd>
              <dt className="text-dim">Status</dt>
              <dd className={tenant.mt5.status === 'connected' ? 'text-pos' : 'text-warn'}>
                {tenant.mt5.status}
              </dd>
              <dt className="text-dim">Currency</dt>
              <dd>{tenant.mt5.accountCurrency ?? '—'}</dd>
              <dt className="text-dim">Last sync</dt>
              <dd className="tri-num">{stamp(tenant.mt5.lastSyncAt)}</dd>
            </dl>
          ) : (
            <p className="text-dim py-4 text-center text-xs">
              No MT5 account connected. The client connects it themselves from Settings —
              {/* Operators must never be in a position to hold a client's broker password. */}
              {' '}the investor password is never entered here.
            </p>
          )}
        </Card>
      </div>

      <Card title="Details">
        <EditTenantForm
          tenantId={tenant.id}
          defaults={{ name: tenant.name, domain: tenant.domain, notes: tenant.notes ?? '' }}
        />
      </Card>

      <Card title="Sync history">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-dim text-[11px]">
                {['Started', 'Trigger', 'Status', 'Imported', 'Updated', 'Error'].map((header) => (
                  <th
                    key={header}
                    className="border-line border-b px-3 py-2 text-start font-semibold"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-line border-b last:border-b-0">
                  <td className="tri-num text-dim px-3 py-2 text-xs whitespace-nowrap">
                    {stamp(log.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-xs">{log.trigger}</td>
                  <td
                    className={`px-3 py-2 text-xs ${
                      log.status === 'error'
                        ? 'text-neg'
                        : log.status === 'success'
                          ? 'text-pos'
                          : 'text-warn'
                    }`}
                  >
                    {log.status}
                  </td>
                  <td className="tri-num px-3 py-2 text-xs">{log.tradesImported}</td>
                  <td className="tri-num px-3 py-2 text-xs">{log.tradesUpdated}</td>
                  <td
                    className="text-neg max-w-[24rem] truncate px-3 py-2 text-xs"
                    data-tip={log.error ?? ''}
                  >
                    {log.error ?? ''}
                  </td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-dim px-3 py-6 text-center">
                    No syncs recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Client password">
        <SetPasswordForm tenantId={tenant.id} />
      </Card>

      <Card title="Danger zone">
        <DangerZone tenantId={tenant.id} domain={tenant.domain} counts={tenant.counts} />
      </Card>
    </div>
  );
}
