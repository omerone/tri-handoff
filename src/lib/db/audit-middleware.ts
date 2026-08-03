import 'server-only';
 
import { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { currentAuditIdentity } from '@/lib/auth/audit-identity';
import { clientIp } from '@/lib/auth/limits';

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

/**
 * What `Prisma.MiddlewareParams` used to carry.
 *
 * Prisma removed `$use` and its types in v5; this file was written against them and did not
 * compile against the v6 client the project ships. The shape is reconstructed here because
 * the helpers below are worth keeping as they are — only the plumbing changed.
 */
interface AuditParams {
  model?: string;
  action: string;
  args: { data?: unknown; where?: unknown } & Record<string, unknown>;
}

interface AuditContext {
  userId?: string;
  tenantId?: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Extract audit context from the request, when there is one.
 *
 * The address comes from `clientIp()` rather than being read here, and that is the whole
 * point: `X-Forwarded-For` is a list the caller may prepend to, so taking its first entry —
 * which this did — records whatever address the attacker chose to type. An audit trail that
 * can be told what to say about who did something is worse than one with no address at all,
 * because it will be believed. `clientIp()` prefers `X-Real-Ip`, which Caddy sets from the
 * socket peer and the caller cannot influence.
 *
 * There is often no request at all: the maintenance timer, the quote refresh and the CLI
 * scripts all write through the same client. `headers()` throws there, and a trail entry with
 * no address is the correct record of a background job.
 */
async function getAuditContext(): Promise<AuditContext> {
  try {
    const headerStore = await headers();
    const ip = await clientIp();
    return {
      // `clientIp` says "unknown" when it cannot tell; a trail column reads better as null.
      ipAddress: ip === 'unknown' ? null : ip,
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

  /*
   * Anything that is not a plain object keeps its own string form.
   *
   * Walking one with `Object.entries` rebuilds it as a plain object, and for the two types
   * this schema is full of that is fatal: a `Decimal` becomes `{s, e, d}` and a `Date` becomes
   * `{}`. Prisma then refuses to serialize the result into the JSON column and the whole audit
   * write throws — swallowed by the `catch` around it, so the row is simply never written.
   * Every mutation carrying a price or a timestamp — which is to say every trade, position,
   * finance entry and quote in the product — was missing from the trail, and the trail looked
   * healthy because the rows that *did* land were the ones with nothing but strings in them.
   */
  const prototype = Object.getPrototypeOf(obj) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    return obj instanceof Date ? obj.toISOString() : String(obj);
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
  params: AuditParams,
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
 * Who did this.
 *
 * The session first, and that is the fix rather than a refinement: reading `userId` out of
 * the arguments only works for a `create` that happens to carry one. Every `updateMany` and
 * every `delete` in this codebase is keyed by id — `where: { id, userId }` sometimes, `where:
 * { id }` often — so the column was empty on most rows, and an audit trail that records what
 * changed but not who changed it answers the wrong half of the question it exists for.
 *
 * `getSession()` is request-cached and reads no more rows than the page already did. Outside
 * a request — the maintenance timer, the quote refresh, the CLI scripts — it returns null and
 * the arguments are the only thing left to go on.
 */
async function extractUserContext(params: AuditParams): Promise<{
  userId?: string;
  tenantId?: string;
}> {
  const identity = await currentAuditIdentity();
  if (identity) return identity;

  const data = params.args.data || params.args.where;
  if (typeof data === 'object' && data !== null) {
    return {
      userId: (data as Record<string, unknown>).userId as string | undefined,
      tenantId: (data as Record<string, unknown>).tenantId as string | undefined,
    };
  }
  return {};
}

/** Only mutations are logged; reads would bury the trail in noise. */
const MUTATING_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/**
 * The audit trail, as a Prisma client extension.
 *
 * Prisma removed `$use` in v5 and this project is on v6, so the middleware this file was
 * written as could not run at all. Extensions are the replacement, with one consequence worth
 * knowing: `$extends` *returns a new client* rather than mutating the one it is given, so
 * this cannot be a `setupAuditMiddleware()` called for its side effect. The extended client
 * has to become the client the app uses:
 *
 *     export const prisma = new PrismaClient(...).$extends(auditExtension);
 *
 * It is exported rather than applied here on purpose. Switching it on writes a row for every
 * mutation the product makes, which is a decision about storage and write latency, not a
 * detail of this module.
 */
export const auditExtension = Prisma.defineExtension({
  name: 'audit-log',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // The audit write is itself a `create`. Without this the extension would audit its
        // own row, and audit that, until the stack gave out.
        if (model === 'DatabaseAuditLog' || !MUTATING_ACTIONS.has(operation)) {
          return query(args);
        }

        const startTime = Date.now();
        let result: unknown;
        let failed = false;
        try {
          result = await query(args);
          return result;
        } catch (err) {
          failed = true;
          throw err;
        } finally {
          const executionTimeMs = Date.now() - startTime;
          const params: AuditParams = {
            model,
            action: operation,
            args: (args ?? {}) as AuditParams['args'],
          };

          // Deliberately not awaited: the trail must not sit in front of the write it
          // describes. Failures are swallowed by `logAuditOperation` itself.
          void (async () => {
            try {
              const context = await getAuditContext();
              const userContext = await extractUserContext(params);
              const { suspicious, reason } = checkSuspicious(params, executionTimeMs);

              let logged = 'INSERT';
              if (operation.includes('update') || operation === 'upsert') logged = 'UPDATE';
              if (operation.includes('delete')) logged = 'DELETE';

              await logAuditOperation({
                tableName: model ?? 'unknown',
                operation: logged,
                params,
                result: failed ? null : result,
                context: { ...context, ...userContext },
                executionTimeMs,
                suspicious,
                suspicionReason: reason,
              });
            } catch (err) {
              console.error('Error in audit extension:', err);
            }
          })();
        }
      },
    },
  },
});

/**
 * Log an audit operation (called asynchronously)
 */
async function logAuditOperation(opts: {
  tableName: string;
  operation: string;
  params: AuditParams;
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
      /*
       * `create` and `update` as well as `data`, because an upsert has no `data`.
       *
       * It is in the audited-operations list, so the row was written — with `newValues` empty.
       * That is how the MT5 connection, which is an upsert, produced an audit entry saying
       * that something had changed on the account and nothing about what.
       *
       * Which branch of an upsert ran is not knowable from here, so both are recorded under
       * their own names rather than guessed at.
       */
      const { data, create, update } = opts.params.args as {
        data?: unknown;
        create?: unknown;
        update?: unknown;
      };
      const payload = data ?? (create || update ? { create, update } : undefined);
      if (payload) newValues = redactSensitiveFields(payload);
    }

    // Extract record ID
    if (opts.params.args.where && typeof opts.params.args.where === 'object') {
      const whereClause = opts.params.args.where as Record<string, unknown>;
      recordId = String(whereClause.id || whereClause.userId || '');
    }
    if (opts.result && typeof opts.result === 'object' && 'id' in opts.result) {
      recordId = String((opts.result as Record<string, unknown>).id || '');
    }

    // Imported here, not at the top of the file: `prisma.ts` imports this module to build the
    // client, so a static import back would be a cycle — one of the two modules would see
    // `undefined` at evaluation time. Loading it inside the write, which already runs after
    // both modules exist, breaks the cycle without a trick.
    const { prismaBase } = await import('@/lib/db/prisma');

    // Create audit log entry
    await prismaBase.databaseAuditLog.create({
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

  const { prismaBase } = await import('@/lib/db/prisma');
  return prismaBase.databaseAuditLog.findMany({
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
  const { prismaBase } = await import('@/lib/db/prisma');
  return prismaBase.databaseAuditLog.findMany({
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
