import { Card } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';
import { requireAdmin } from '@/lib/auth/admin-session';
import { platformStats, syncHealth } from '@/lib/db/unscoped';
import { adminSignOutAction } from './actions';
import { CreateTenantForm } from './create-tenant-form';
import { HealthTable } from './health';

export const dynamic = 'force-dynamic';

/**
 * The operator panel (SPEC §6, phase 4).
 *
 * Ordered by what an operator opens it to find out: is anything broken, then who are my
 * clients, then let me add one. The monitoring table is above the create form for that
 * reason — creating a client is the rarer action.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();
  const [stats, health] = await Promise.all([platformStats(), syncHealth()]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold">TRi — operator</h1>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Clients" value={String(stats.tenants)} />
        <KPI label="Active" value={String(stats.active)} />
        <KPI label="MT5 connected" value={String(stats.connected)} />
        <KPI
          label="Sync failing"
          value={String(stats.failing)}
          tone={stats.failing > 0 ? 'neg' : 'neutral'}
        />
      </div>

      <Card title="Clients — most in need of attention first" pad={false}>
        <HealthTable rows={health} />
      </Card>

      <Card title="New client">
        <CreateTenantForm />
      </Card>
    </div>
  );
}
