import 'server-only';
// eslint-disable-next-line no-restricted-imports
import { prisma } from '@/lib/db/prisma';

/**
 * Audit Log Query Functions
 *
 * Convenience functions for querying database audit logs
 * Used for: compliance reporting, forensic investigation, security monitoring
 */

interface AuditLogEntry {
  id: string;
  tableName: string;
  operation: string;
  recordId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  userId: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  executionTimeMs: number | null;
  suspicious: boolean;
  suspicionReason: string | null;
  createdAt: Date;
}

/**
 * Get user's audit log (all operations performed by a user)
 * Used for: security investigation, user activity report
 */
export async function getUserAuditLog(
  userId: string,
  options = { limit: 1000, offset: 0 }
): Promise<AuditLogEntry[]> {
  return (await prisma.databaseAuditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    skip: options.offset,
  })) as AuditLogEntry[];
}

/**
 * Get data access log for a specific table
 * Used for: table-level audit trail, data governance
 */
export async function getTableAuditLog(
  tableName: string,
  options = { limit: 1000, offset: 0 }
): Promise<AuditLogEntry[]> {
  return (await prisma.databaseAuditLog.findMany({
    where: { tableName },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    skip: options.offset,
  })) as AuditLogEntry[];
}

/**
 * Get audit log for a specific record
 * Used for: investigating what happened to a particular row
 */
export async function getRecordAuditLog(
  tableName: string,
  recordId: string,
  options = { limit: 1000 }
): Promise<AuditLogEntry[]> {
  return (await prisma.databaseAuditLog.findMany({
    where: { tableName, recordId },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Get suspicious activity in a time window
 * Used for: security monitoring, breach detection
 */
export async function getSuspiciousActivity(
  options = { timeWindowHours: 24, limit: 100 }
): Promise<AuditLogEntry[]> {
  const since = new Date(Date.now() - options.timeWindowHours * 60 * 60 * 1000);

  return (await prisma.databaseAuditLog.findMany({
    where: {
      suspicious: true,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Get slow queries
 * Used for: performance monitoring, optimization
 */
export async function getSlowQueries(
  options = { thresholdMs: 5000, limit: 100, hoursBack: 24 }
): Promise<AuditLogEntry[]> {
  const since = new Date(Date.now() - options.hoursBack * 60 * 60 * 1000);

  return (await prisma.databaseAuditLog.findMany({
    where: {
      executionTimeMs: { gte: options.thresholdMs },
      createdAt: { gte: since },
    },
    orderBy: { executionTimeMs: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Get data access log (who accessed what data)
 * Used for: GDPR compliance, data governance
 */
export async function getDataAccessLog(
  options = { tableName?: string, timeWindowDays: 7, limit: 1000 }
): Promise<AuditLogEntry[]> {
  const since = new Date(Date.now() - options.timeWindowDays * 24 * 60 * 60 * 1000);

  return (await prisma.databaseAuditLog.findMany({
    where: {
      tableName: options.tableName,
      operation: { in: ['INSERT', 'UPDATE', 'DELETE'] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Get activity by IP address
 * Used for: identifying compromised accounts, fraudulent activity
 */
export async function getActivityByIP(
  ipAddress: string,
  options = { limit: 1000 }
): Promise<AuditLogEntry[]> {
  return (await prisma.databaseAuditLog.findMany({
    where: { ipAddress },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Get recent activity
 * Used for: real-time monitoring, dashboard
 */
export async function getRecentActivity(
  options = { minutesBack: 60, limit: 100 }
): Promise<AuditLogEntry[]> {
  const since = new Date(Date.now() - options.minutesBack * 60 * 1000);

  return (await prisma.databaseAuditLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  })) as AuditLogEntry[];
}

/**
 * Export audit log to array (for CSV export, API response)
 * Used for: compliance reporting, external audit
 */
export async function exportAuditLog(
  // `:` rather than `=` — as written this was a default *value* holding type syntax, which
  // is a parse error, and one bad signature takes the whole typecheck down with it.
  options: {
    startDate?: Date;
    endDate?: Date;
    tableName?: string;
    userId?: string;
    suspicious?: boolean;
  } = {}
): Promise<AuditLogEntry[]> {
  const where: Record<string, unknown> = {};

  if (options.startDate || options.endDate) {
    where.createdAt = {};
    if (options.startDate) {
      (where.createdAt as Record<string, Date>).gte = options.startDate;
    }
    if (options.endDate) {
      (where.createdAt as Record<string, Date>).lte = options.endDate;
    }
  }

  if (options.tableName) {
    where.tableName = options.tableName;
  }

  if (options.userId) {
    where.userId = options.userId;
  }

  if (options.suspicious !== undefined) {
    where.suspicious = options.suspicious;
  }

  return (await prisma.databaseAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })) as AuditLogEntry[];
}

/**
 * Get audit statistics
 * Used for: monitoring, alerting
 */
export async function getAuditStatistics(
  options = { hoursBack: 24 }
): Promise<{
  totalOperations: number;
  operationsByType: Record<string, number>;
  operationsByTable: Record<string, number>;
  suspiciousCount: number;
  affectedUsers: number;
  affectedTenants: number;
}> {
  const since = new Date(Date.now() - options.hoursBack * 60 * 60 * 1000);

  const logs = await prisma.databaseAuditLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      operation: true,
      tableName: true,
      suspicious: true,
      userId: true,
      tenantId: true,
    },
  });

  const stats = {
    totalOperations: logs.length,
    operationsByType: {} as Record<string, number>,
    operationsByTable: {} as Record<string, number>,
    suspiciousCount: 0,
    affectedUsers: new Set<string>(),
    affectedTenants: new Set<string>(),
  };

  for (const log of logs) {
    // Count by operation type
    stats.operationsByType[log.operation] = (stats.operationsByType[log.operation] || 0) + 1;

    // Count by table
    stats.operationsByTable[log.tableName] = (stats.operationsByTable[log.tableName] || 0) + 1;

    // Count suspicious
    if (log.suspicious) {
      stats.suspiciousCount += 1;
    }

    // Track affected users and tenants
    if (log.userId) {
      stats.affectedUsers.add(log.userId);
    }
    if (log.tenantId) {
      stats.affectedTenants.add(log.tenantId);
    }
  }

  return {
    totalOperations: stats.totalOperations,
    operationsByType: stats.operationsByType,
    operationsByTable: stats.operationsByTable,
    suspiciousCount: stats.suspiciousCount,
    affectedUsers: stats.affectedUsers.size,
    affectedTenants: stats.affectedTenants.size,
  };
}

/**
 * Clean up old audit logs (retention policy)
 * Keep 12 months of logs, archive anything older
 * Run daily via cron job
 */
export async function archiveOldAuditLogs(
  options = { retentionDays: 90 }
): Promise<{ archived: number }> {
  const cutoffDate = new Date(Date.now() - options.retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.databaseAuditLog.updateMany({
    where: {
      archived: false,
      createdAt: { lt: cutoffDate },
    },
    data: {
      archived: true,
    },
  });

  return { archived: result.count };
}

/**
 * Delete archived logs older than retention period
 * Keep 12 months total (90 days active, 275 days archived)
 */
export async function deleteArchivedLogs(
  options = { retentionMonths: 12 }
): Promise<{ deleted: number }> {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - options.retentionMonths);

  const result = await prisma.databaseAuditLog.deleteMany({
    where: {
      archived: true,
      createdAt: { lt: cutoffDate },
    },
  });

  return { deleted: result.count };
}
