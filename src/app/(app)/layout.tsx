import { TenantGate } from '@/components/tenant-gate';
import { AppShell } from '@/components/shell/app-shell';
import { LiveRefresh } from '@/components/shell/live-refresh';
import { SessionExpiry } from '@/components/shell/session-expiry';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_WARN_BEFORE_MS,
} from '@/lib/auth/session-limits';
import { requireSession } from '@/lib/auth/session';

/**
 * Nothing under a tenant route group may ever be prerendered.
 *
 * Every page here happens to be dynamic today because it reaches `cookies()` or `headers()`
 * through the gate — but that is a property of the current code, not a guarantee. The first
 * page that renders without touching a request API would be built once and served to every
 * client, which for a multi-tenant product means one trader's numbers on another's domain.
 * Declaring it at the segment root makes it structural instead of incidental.
 */
export const dynamic = 'force-dynamic';

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
  return (
    <AppShell session={session}>
      <LiveRefresh />
      {/*
        Numbers, not a formatter. The countdown's own strings are translated inside the
        component; anything that has to be *called* cannot cross this boundary.
      */}
      <SessionExpiry
        idleMs={SESSION_IDLE_TTL_MS}
        warnMs={SESSION_WARN_BEFORE_MS}
        endsAt={session.startedAt.getTime() + SESSION_ABSOLUTE_TTL_MS}
      />
      {children}
    </AppShell>
  );
}
