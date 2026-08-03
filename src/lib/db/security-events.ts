import 'server-only';
import { prisma } from './prisma';

/**
 * The security tables: authentication events, data access, and operator actions.
 *
 * These are the one family of tables that is deliberately *not* tenant-scoped, and the reason
 * is in what they are for. An admin action spans tenants by definition; a failed login is
 * recorded before anyone knows which tenant the attempt belonged to; "who exported what"
 * has to be answerable across the whole deployment during an incident. So they take a user
 * id rather than a `TenantContext`, and this file is the single place that says so.
 *
 * It exists because `src/lib/security/*` was importing the Prisma client directly, behind
 * `eslint-disable no-restricted-imports`. That guard is the tenant-isolation guard — the one
 * thing standing between this codebase and one client reading another's trades — and a
 * comment that switches it off is indistinguishable from the mistake it was written to catch.
 * Everything that needs unscoped access to these tables asks for it here, by name.
 */

/** Both nullable columns, so "no address known" is recorded rather than left to a default. */
export type EventContext = {
  ipAddress: string | null;
  userAgent: string | null;
};

export async function recordAuthEvent(params: {
  userId: string;
  eventType: string;
  description: string;
  result: string;
  details?: Record<string, string>;
  context: EventContext;
}): Promise<void> {
  await prisma.authEvent.create({
    data: {
      userId: params.userId,
      eventType: params.eventType,
      description: params.description,
      result: params.result,
      ipAddress: params.context.ipAddress,
      userAgent: params.context.userAgent,
      details: params.details ?? undefined,
    },
  });
}

export async function recordDataAccess(params: {
  userId: string;
  action: string;
  resource: string;
  recordCount?: number;
  dataSizeBytes?: number;
  ipAddress: string | null;
}): Promise<void> {
  await prisma.dataAccessLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      recordCount: params.recordCount,
      dataSizeBytes: params.dataSizeBytes,
      ipAddress: params.ipAddress,
    },
  });
}

export async function recordAdminAction(params: {
  adminId?: string;
  tenantId?: string;
  userId?: string;
  actionType: string;
  description: string;
  /** A Json column: the object goes in as-is, never stringified. */
  changes?: Record<string, unknown>;
  context: EventContext;
}): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      tenantId: params.tenantId,
      userId: params.userId,
      actionType: params.actionType,
      description: params.description,
      changes: (params.changes ?? undefined) as never,
      ipAddress: params.context.ipAddress,
      userAgent: params.context.userAgent,
    },
  });
}

export function countRecentAuthEvents(params: {
  userId: string;
  eventType: string;
  since: Date;
}): Promise<number> {
  return prisma.authEvent.count({
    where: {
      userId: params.userId,
      eventType: params.eventType,
      createdAt: { gte: params.since },
    },
  });
}

/** `[{ userId, count }]` — one row per user, for threshold alerting. */
export async function countAuthEventsByUser(params: {
  eventType: string;
  result?: string;
  since: Date;
}): Promise<{ userId: string; count: number }[]> {
  const grouped = await prisma.authEvent.groupBy({
    by: ['userId'],
    where: {
      eventType: params.eventType,
      ...(params.result ? { result: params.result } : {}),
      createdAt: { gte: params.since },
    },
    _count: { id: true },
  });
  return grouped.map((row) => ({ userId: row.userId, count: row._count.id }));
}

export async function countAdminActionsByAdmin(params: {
  since: Date;
}): Promise<{ adminId: string | null; count: number }[]> {
  const grouped = await prisma.adminAuditLog.groupBy({
    by: ['adminId'],
    where: { createdAt: { gte: params.since } },
    _count: { id: true },
  });
  return grouped.map((row) => ({ adminId: row.adminId, count: row._count.id }));
}

export function listLargeExports(params: { since: Date; minRecords: number }): Promise<
  {
    id: string;
    userId: string;
    recordCount: number | null;
    resource: string;
    createdAt: Date;
  }[]
> {
  return prisma.dataAccessLog.findMany({
    where: {
      action: 'export',
      createdAt: { gte: params.since },
      recordCount: { gte: params.minRecords },
    },
    select: { id: true, userId: true, recordCount: true, resource: true, createdAt: true },
  });
}

/**
 * Addresses for a set of users, in one query.
 *
 * The callers each looped over their findings calling `findUnique` per row — an alert sweep
 * over a hundred failed logins was a hundred round trips, at exactly the moment the database
 * is already under whatever caused the alert.
 */
export async function findUserEmails(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, email: true },
  });
  return new Map(rows.map((row) => [row.id, row.email]));
}

/**
 * The stored password hash, for re-authentication before a destructive action.
 *
 * Deliberately its own function rather than a general "get me the user": the hash is the one
 * column that must never be handed out casually, so the only way to reach it is to ask for
 * it by this name, and the only caller is the account-deletion confirmation.
 */
export async function findPasswordHash(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  return row?.passwordHash ?? null;
}
