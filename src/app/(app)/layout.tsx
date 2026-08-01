import { TenantGate } from '@/components/tenant-gate';
import { AppShell } from '@/components/shell/app-shell';
import { requireSession } from '@/lib/auth/session';

/**
 * Everything behind the login wall. Two gates in order: the host must belong to an active
 * tenant, then the request must carry a session issued *for that tenant*.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TenantGate>
      <Protected>{children}</Protected>
    </TenantGate>
  );
}

async function Protected({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
