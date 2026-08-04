import 'server-only';
import type { TenantStatus } from '@prisma/client';
import type { ActiveTenant } from '@/lib/tenant/context';
import { normalizeDomain } from '@/lib/tenant/domain';
import { prisma } from './prisma';

export type TenantLookup =
  | { state: 'active'; tenant: ActiveTenant }
  | { state: 'suspended'; tenant: ActiveTenant }
  | { state: 'unknown' };

/**
 * Host → tenant. The only query in the codebase that is *not* tenant-scoped, because it is
 * the query that establishes the scope.
 */
export async function lookupTenantByDomain(host: string): Promise<TenantLookup> {
  const domain = normalizeDomain(host);
  if (!domain) return { state: 'unknown' };

  const row = await prisma.tenant.findUnique({
    where: { domain },
    select: { id: true, name: true, domain: true, status: true },
  });

  if (!row) return { state: 'unknown' };

  const tenant: ActiveTenant = { id: row.id, name: row.name, domain: row.domain };
  return row.status === 'active' ? { state: 'active', tenant } : { state: 'suspended', tenant };
}

/** Used by Caddy's on-demand TLS `ask` endpoint: may we issue a certificate for this host? */
export async function isProvisionedDomain(host: string): Promise<boolean> {
  const domain = normalizeDomain(host);
  if (!domain) return false;
  const count = await prisma.tenant.count({ where: { domain, status: 'active' } });
  return count > 0;
}

export type TenantSummary = {
  id: string;
  name: string;
  domain: string;
  status: TenantStatus;
  createdAt: Date;
  userEmail: string | null;
  lastSyncAt: Date | null;
};

/** Super-admin listing. Not tenant-scoped by design — this is the cross-tenant view. */
export async function listTenants(): Promise<TenantSummary[]> {
  const rows = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      createdAt: true,
      user: { select: { email: true, mt5Account: { select: { lastSyncAt: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    status: row.status,
    createdAt: row.createdAt,
    userEmail: row.user?.email ?? null,
    lastSyncAt: row.user?.mt5Account?.lastSyncAt ?? null,
  }));
}

export async function setTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
  await prisma.tenant.update({ where: { id: tenantId }, data: { status } });
}
