import 'server-only';
// eslint-disable-next-line no-restricted-imports
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';

/**
 * Database Audit Middleware
 *
 * Integrates with Prisma to log all database operations to DatabaseAuditLog.
 * Features:
 * - Logs INSERT, UPDATE, DELETE operations
 * - Redacts sensitive fields (passwords, tokens, keys)
 * - Captures user context (userId, tenantId, IP, userAgent)
 * - Flags suspicious activities (slow queries, large operations)
 * - Async logging to avoid performance degradation
 *
 * Usage: Call setupAuditMiddleware() once during app initialization
 */

/** Sensitive fields that should never be logged in plain text */
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'key',
  'encryptionKey',
  'investorPw',
  'investorPwEncrypted',
  'refreshToken',
  'accessToken',
  'apiKey',
  'apiSecret',
  'masterPassword',
  'sessionSecret',
  'jwtSecret',
]);

interface AuditContext {
  userId?: string;
  tenantId?: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Extract audit context from request headers
 */
async function getAuditContext(): Promise<AuditContext> {
  try {
    const headerStore = await headers();
    return {
      ipAddress: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: headerStore.get('user-agent')?.slice(0, 300) ?? null,
    };
  } catch {
    return {
      ipAddress: null,
      userAgent: null,
    };
  }
}

/**
 * Redact sensitive fields from values
 */
function redactSensitiveFields(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      result[key] = redactSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Determine if an operation is suspicious
 */
function checkSuspicious(
  params: Prisma.MiddlewareParams,
  executionTimeMs: number
): { suspicious: boolean; reason?: string } {
  // Flag slow queries (>5 seconds)
  if (executionTimeMs > 5000) {
    return {
      suspicious: true,
      reason: 'slow_query',
    };
  }

  // Flag bulk deletes (DELETE without WHERE clause)
  if (params.action === 'deleteMany') {
    // Check if the delete is unfiltered (dangerous)
    if (!params.args.where || Object.keys(params.args.where).length === 0) {
      return {
        suspicious: true,
        reason: 'bulk_delete_unfiltered',
      };
    }
  }

  // Flag bulk updates
  if (params.action === 'updateMany') {
    if (!params.args.where || Object.keys(params.args.where).length === 0) {
      return {
        suspicious: true,
        reason: 'bulk_update_unfiltered',
      };
    }
  }

  return { suspicious: false };
}

/**
 * Extract user context from operation params
 */
function extractUserContext(params: Prisma.MiddlewareParams): {
  userId?: string;
  tenantId?: string;
} {
  // Try to extract from the data being operated on
  const data = params.args.data || params.args.where;
  if (typeof data === 'object' && data !== null) {
    return {
      userId: (data as Record<string, unknown>).userId as string | undefined,
      tenantId: (data as Record<string, unknown>).tenantId as string | undefined,
    };
  }
  return {};
}

/**
 * Setup audit middleware on the Prisma client
 * Call this once during app initialization
 */
export function setupAuditMiddleware() {
  // Only log mutating operations, not reads
  const MUTATING_ACTIONS = new Set([
    'create',
    'createMany',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'upsert',
  ]);

  prisma.$use(async (params, next) => {
    const startTime = Date.now();
    let result;
    let error: Error | null = null;

    try {
      result = await next(params);
    } catch (err) {
      error = err as Error;
      throw err;
    } finally {
      const executionTimeMs = Date.now() - startTime;

      // Only log mutating operations
      if (!MUTATING_ACTIONS.has(params.action)) {
        return;
      }

      // Log asynchronously to avoid performance impact
      try {
        const context = await getAuditContext();
        const userContext = extractUserContext(params);
        const { suspicious, reason } = checkSuspicious(params, executionTimeMs);

        // Determine operation type
        let operation = 'INSERT';
        if (params.action.includes('update')) operation = 'UPDATE';
        if (params.action.includes('delete')) operation = 'DELETE';

        // Log to database
        // Note: Running in background doesn't await, preventing performance degradation
        logAuditOperation({
          tableName: params.model || 'unknown',
          operation,
          params,
          result: error ? null : result,
          context: { ...context, ...userContext },
          executionTimeMs,
          suspicious,
          suspicionReason: reason,
        }).catch((err) => {
          // Audit logging failure should not crash the app
          console.error('Failed to log audit operation:', err);
        });
      } catch (err) {
        console.error('Error in audit middleware:', err);
      }
    }
  });
}

/**
 * Log an audit operation (called asynchronously)
 */
async function logAuditOperation(opts: {
  tableName: string;
  operation: string;
  params: Prisma.MiddlewareParams;
  result: unknown;
  context: AuditContext;
  executionTimeMs: number;
  suspicious: boolean;
  suspicionReason?: string;
}): Promise<void> {
  try {
    // Extract old and new values
    let oldValues: unknown = null;
    let newValues: unknown = null;
    let recordId = '';

    if (opts.operation === 'UPDATE' || opts.operation === 'DELETE') {
      // For updates/deletes, we get the old values from the result (if available)
      if (opts.result && typeof opts.result === 'object') {
        oldValues = redactSensitiveFields(opts.result);
      }
    }

    if (opts.operation === 'INSERT' || opts.operation === 'UPDATE') {
      // For inserts/updates, the new values are in params.args.data
      if (opts.params.args.data) {
        newValues = redactSensitiveFields(opts.params.args.data);
      }
    }

    // Extract record ID
    if (opts.params.args.where && typeof opts.params.args.where === 'object') {
      const whereClause = opts.params.args.where as Record<string, unknown>;
      recordId = String(whereClause.id || whereClause.userId || '');
    }
    if (opts.result && typeof opts.result === 'object' && 'id' in opts.result) {
      recordId = String((opts.result as Record<string, unknown>).id || '');
    }

    // Create audit log entry
    await prisma.databaseAuditLog.create({
      data: {
        tableName: opts.tableName,
        operation: opts.operation,
        recordId: recordId || 'unknown',
        oldValues: oldValues as Prisma.InputJsonValue,
        newValues: newValues as Prisma.InputJsonValue,
        userId: opts.context.userId,
        tenantId: opts.context.tenantId,
        ipAddress: opts.context.ipAddress,
        userAgent: opts.context.userAgent,
        executionTimeMs: opts.executionTimeMs,
        suspicious: opts.suspicious,
        suspicionReason: opts.suspicionReason,
      },
    });

    // Alert on suspicious activity
    if (opts.suspicious) {
      console.warn(
        `[AUDIT] Suspicious operation detected: ${opts.tableName}.${opts.operation} (${opts.suspicionReason})`
      );
    }
  } catch (err) {
    console.error('Failed to create audit log entry:', err);
    // Don't throw - audit failures should not break the application
  }
}

/**
 * Query audit logs for suspicious activity
 */
export async function getSuspiciousActivity(
  timeWindowHours = 24
): Promise<
  Array<{
    id: string;
    tableName: string;
    operation: string;
    suspicionReason: string | null;
    userId: string | null;
    ipAddress: string | null;
    createdAt: Date;
  }>
> {
  const since = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

  return prisma.databaseAuditLog.findMany({
    where: {
      suspicious: true,
      createdAt: { gte: since },
    },
    select: {
      id: true,
      tableName: true,
      operation: true,
      suspicionReason: true,
      userId: true,
      ipAddress: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Query user's audit trail
 */
export async function getUserAuditTrail(
  userId: string,
  options = { limit: 1000 }
): Promise<
  Array<{
    id: string;
    tableName: string;
    operation: string;
    recordId: string;
    createdAt: Date;
    ipAddress: string | null;
  }>
> {
  return prisma.databaseAuditLog.findMany({
    where: { userId },
    select: {
      id: true,
      tableName: true,
      operation: true,
      recordId: true,
      createdAt: true,
      ipAddress: true,
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
  });
}
