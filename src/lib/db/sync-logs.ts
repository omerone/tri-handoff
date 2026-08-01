import 'server-only';
import type { SyncStatus, SyncTrigger } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * A row per sync attempt — what the user's "last synced" pill reads, and what the operator
 * panel needs to answer "why has this client seen no new trades since Tuesday" (SPEC §2,
 * "ניטור סנכרונים").
 */

export type SyncLogRecord = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncStatus;
  trigger: SyncTrigger;
  tradesImported: number;
  tradesUpdated: number;
  error: string | null;
};

export async function startSyncLog(ctx: TenantContext, trigger: SyncTrigger): Promise<string> {
  assertContext(ctx);
  const row = await prisma.syncLog.create({
    data: { userId: ctx.userId, trigger, status: 'running' },
    select: { id: true },
  });
  return row.id;
}

export async function finishSyncLog(
  ctx: TenantContext,
  id: string,
  result:
    | { status: 'success'; tradesImported: number; tradesUpdated: number }
    | { status: 'error'; error: string },
): Promise<void> {
  assertContext(ctx);
  await prisma.syncLog.updateMany({
    where: { id, userId: ctx.userId },
    data: {
      finishedAt: new Date(),
      status: result.status,
      ...(result.status === 'success'
        ? { tradesImported: result.tradesImported, tradesUpdated: result.tradesUpdated }
        : // Truncated: a provider stack trace can be long, and it is shown to a human.
          { error: result.error.slice(0, 500) }),
    },
  });
}

export async function latestSyncLog(ctx: TenantContext): Promise<SyncLogRecord | null> {
  assertContext(ctx);
  return prisma.syncLog.findFirst({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    orderBy: { startedAt: 'desc' },
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

export async function recentSyncLogs(ctx: TenantContext, limit = 20): Promise<SyncLogRecord[]> {
  assertContext(ctx);
  return prisma.syncLog.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
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

/**
 * Marks a run that never finished as failed.
 *
 * A process killed mid-sync leaves a `running` row forever, and the UI would show a spinner
 * that never stops. Called before starting a new sync.
 */
export async function failStaleSyncLogs(ctx: TenantContext, olderThanMs = 10 * 60 * 1000): Promise<void> {
  assertContext(ctx);
  await prisma.syncLog.updateMany({
    where: {
      userId: ctx.userId,
      status: 'running',
      startedAt: { lt: new Date(Date.now() - olderThanMs) },
    },
    data: { status: 'error', finishedAt: new Date(), error: 'Interrupted' },
  });
}
