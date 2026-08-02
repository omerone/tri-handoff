import 'server-only';
import type { TenantStatus } from '@prisma/client';
import { isValidDomain, normalizeDomain } from '@/lib/tenant/domain';
import { prisma } from './prisma';

/**
 * Cross-tenant operator queries (SPEC §2, §6 phase 4).
 *
 * Everything here deliberately spans tenants, which is why it lives beside the other
 * unscoped primitives and is reachable only from `src/app/admin`. The lint rule that keeps
 * `@/lib/db/unscoped` out of application code is what makes that boundary real.
 */

export type TenantDetail = {
  id: string;
  name: string;
  domain: string;
  status: TenantStatus;
  notes: string | null;
  createdAt: Date;
  user: {
    email: string;
    locale: string;
    displayCurrency: string;
    lastLoginAt: Date | null;
  } | null;
  mt5: {
    login: string;
    server: string;
    status: string;
    lastSyncAt: Date | null;
    accountCurrency: string | null;
  } | null;
  counts: {
    trades: number;
    financeEntries: number;
    longPositions: number;
  };
  lastSync: {
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    trigger: string;
    tradesImported: number;
    error: string | null;
  } | null;
};

export async function getTenantDetail(tenantId: string): Promise<TenantDetail | null> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      notes: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          email: true,
          locale: true,
          displayCurrency: true,
          lastLoginAt: true,
          mt5Account: {
            select: {
              login: true,
              server: true,
              status: true,
              lastSyncAt: true,
              accountCurrency: true,
            },
          },
          syncLogs: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              startedAt: true,
              finishedAt: true,
              status: true,
              trigger: true,
              tradesImported: true,
              error: true,
            },
          },
          _count: { select: { trades: true, financeEntries: true, longPositions: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    user: row.user
      ? {
          email: row.user.email,
          locale: row.user.locale,
          displayCurrency: row.user.displayCurrency,
          lastLoginAt: row.user.lastLoginAt,
        }
      : null,
    mt5: row.user?.mt5Account ?? null,
    counts: {
      trades: row.user?._count.trades ?? 0,
      financeEntries: row.user?._count.financeEntries ?? 0,
      longPositions: row.user?._count.longPositions ?? 0,
    },
    lastSync: row.user?.syncLogs[0] ?? null,
  };
}

export type SyncHealth = {
  tenantId: string;
  domain: string;
  name: string;
  status: TenantStatus;
  connected: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastError: string | null;
  failuresLast24h: number;
};

/**
 * The monitoring view: one row per client, worst first.
 *
 * "Worst first" is the whole design. An operator opening this screen wants the answer to
 * "is anything broken" without reading, so the order is failing → stale → healthy rather
 * than alphabetical.
 */
export async function syncHealth(): Promise<SyncHealth[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      user: {
        select: {
          mt5Account: { select: { lastSyncAt: true, status: true } },
          syncLogs: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { status: true, error: true },
          },
        },
      },
    },
  });

  const failureCounts = await prisma.syncLog.groupBy({
    by: ['userId'],
    where: { status: 'error', startedAt: { gte: since } },
    _count: { _all: true },
  });
  const failuresByUser = new Map(failureCounts.map((row) => [row.userId, row._count._all]));

  const userIds = await prisma.user.findMany({ select: { id: true, tenantId: true } });
  const userByTenant = new Map(userIds.map((row) => [row.tenantId, row.id]));

  const rows: SyncHealth[] = tenants.map((tenant) => {
    const userId = userByTenant.get(tenant.id);
    const account = tenant.user?.mt5Account ?? null;
    const lastLog = tenant.user?.syncLogs[0] ?? null;

    return {
      tenantId: tenant.id,
      domain: tenant.domain,
      name: tenant.name,
      status: tenant.status,
      connected: account !== null,
      lastSyncAt: account?.lastSyncAt ?? null,
      lastSyncStatus: lastLog?.status ?? null,
      lastError: lastLog?.error ?? null,
      failuresLast24h: userId ? (failuresByUser.get(userId) ?? 0) : 0,
    };
  });

  return rows.sort((a, b) => severity(b) - severity(a));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Higher is more in need of attention. */
function severity(row: SyncHealth): number {
  if (row.status === 'suspended') return 1; // Not broken — deliberately off.
  if (!row.connected) return 3; // Onboarded but never finished setting up.
  if (row.lastSyncStatus === 'error') return 5;
  if (row.failuresLast24h > 0) return 4;
  if (row.lastSyncAt === null) return 3;
  if (Date.now() - row.lastSyncAt.getTime() > 7 * DAY_MS) return 2; // Quiet for a week.
  return 0;
}

export type UpdateTenantInput = {
  name?: string;
  domain?: string;
  notes?: string | null;
};

export type UpdateTenantResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-domain' | 'domain-taken' | 'reserved-domain' | 'not-found' };

/**
 * Renames a client or moves them to a different domain.
 *
 * Rebinding a domain is the operation an operator will reach for when a client's DNS
 * changes, and it is not cosmetic: the domain *is* the tenant's identity at request time, so
 * getting it wrong takes a client offline. Hence the same validation the provisioning path
 * uses, including the reserved-domain check.
 */
export async function updateTenant(
  tenantId: string,
  input: UpdateTenantInput,
): Promise<UpdateTenantResult> {
  const data: { name?: string; domain?: string; notes?: string | null } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name) data.name = name;
  }
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  if (input.domain !== undefined) {
    const domain = normalizeDomain(input.domain);
    if (!isValidDomain(domain)) return { ok: false, reason: 'invalid-domain' };

    const base = process.env.APP_BASE_DOMAIN;
    if (base && normalizeDomain(base) === domain) return { ok: false, reason: 'reserved-domain' };

    const clash = await prisma.tenant.findUnique({ where: { domain }, select: { id: true } });
    if (clash && clash.id !== tenantId) return { ok: false, reason: 'domain-taken' };

    data.domain = domain;
  }

  const { count } = await prisma.tenant.updateMany({ where: { id: tenantId }, data });
  return count > 0 ? { ok: true } : { ok: false, reason: 'not-found' };
}

/**
 * Deletes a client and everything belonging to them.
 *
 * Guarded by a typed confirmation in the UI, because it cascades through trades, finance
 * entries, positions and sessions, and there is no undo.
 */
export async function deleteTenant(tenantId: string): Promise<boolean> {
  const { count } = await prisma.tenant.deleteMany({ where: { id: tenantId } });
  return count > 0;
}

export type SyncLogEntry = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  trigger: string;
  tradesImported: number;
  tradesUpdated: number;
  error: string | null;
};

export async function tenantSyncLogs(tenantId: string, limit = 25): Promise<SyncLogEntry[]> {
  return prisma.syncLog.findMany({
    where: { user: { tenantId } },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      trigger: true,
      tradesImported: true,
      tradesUpdated: true,
      error: true,
    },
  });
}

/** Platform-wide counts for the operator's header. */
export async function platformStats(): Promise<{
  tenants: number;
  active: number;
  connected: number;
  failing: number;
}> {
  const health = await syncHealth();
  return {
    tenants: health.length,
    active: health.filter((row) => row.status === 'active').length,
    connected: health.filter((row) => row.connected).length,
    failing: health.filter((row) => row.lastSyncStatus === 'error').length,
  };
}
