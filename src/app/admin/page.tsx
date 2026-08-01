import { Card } from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth/admin-session';
import { listTenants } from '@/lib/db/unscoped';
import { adminSignOutAction, setTenantStatusAction } from './actions';
import { CreateTenantForm } from './create-tenant-form';

export const dynamic = 'force-dynamic';

/**
 * P0 scope: create a client and enable/suspend one — enough to onboard the first customer.
 * The full panel (domain rebinding, sync monitoring, error triage) is P4.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();
  const tenants = await listTenants();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold">Clients</h1>
          <p className="text-dim text-xs">{admin.email}</p>
        </div>
        <form action={adminSignOutAction}>
          <button
            type="submit"
            className="border-line bg-raised text-dim hover:text-text rounded-full border px-3 py-1.5 text-xs"
          >
            Sign out
          </button>
        </form>
      </div>

      <Card title="New client">
        <CreateTenantForm />
      </Card>

      <Card title={`${tenants.length} client${tenants.length === 1 ? '' : 's'}`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-dim text-[11px]">
                {['Domain', 'Name', 'User', 'Status', 'Last sync', ''].map((header) => (
                  <th
                    key={header}
                    className="border-line border-b px-3 py-2.5 text-start font-semibold"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-line border-b">
                  <td className="tri-num px-3 py-2.5 font-bold">{tenant.domain}</td>
                  <td className="px-3 py-2.5">{tenant.name}</td>
                  <td className="text-dim px-3 py-2.5">{tenant.userEmail ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={tenant.status === 'active' ? 'text-pos' : 'text-warn'}>
                      {tenant.status}
                    </span>
                  </td>
                  <td className="text-dim px-3 py-2.5">
                    {tenant.lastSyncAt ? tenant.lastSyncAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <form action={setTenantStatusAction}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={tenant.status === 'active' ? 'suspended' : 'active'}
                      />
                      <button
                        type="submit"
                        className="border-line bg-raised text-brand rounded-lg border px-2 py-1 text-[11px]"
                      >
                        {tenant.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-dim px-3 py-6 text-center">
                    No clients yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
