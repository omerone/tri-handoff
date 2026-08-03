/**
 * Audit Logger for Rate Limiting and Security Events
 *
 * Logs rate limit violations and other security events for:
 * - Real-time alerting
 * - Forensic investigation
 * - Compliance auditing
 */

import 'server-only';
import { headers } from 'next/headers';

export interface AuditLogEntry {
  action: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  timestamp?: Date;
}

/**
 * Log a security event to the audit trail
 * In production, this would send to a centralized logging service (e.g., Datadog, ELK)
 */
export async function auditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const headersList = await headers();
    const userAgent = headersList.get('user-agent');

    const logEntry = {
      ...entry,
      userAgent: entry.userAgent || userAgent,
      timestamp: entry.timestamp || new Date(),
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('[AUDIT]', JSON.stringify(logEntry, null, 2));
    }

    // In production, send to centralized logging service
    if (process.env.AUDIT_LOG_URL) {
      try {
        await fetch(process.env.AUDIT_LOG_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(logEntry),
        });
      } catch (error) {
        console.error('[AUDIT] Failed to send log to remote:', error);
      }
    }

    // Always log critical events to stderr
    if (entry.severity === 'critical') {
      console.error('[AUDIT-CRITICAL]', JSON.stringify(logEntry, null, 2));
    }
  } catch (error) {
    console.error('[AUDIT] Failed to log entry:', error);
    // Non-fatal: don't let logging failure crash the app
  }
}

/**
 * Log rate limit violation
 */
export async function auditLogRateLimitViolation(
  key: string,
  limit: number,
  retryAfterSeconds: number,
  context?: {
    userId?: string;
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await auditLog({
    action: 'RATE_LIMIT_EXCEEDED',
    userId: context?.userId,
    ip: context?.ip,
    userAgent: context?.userAgent,
    severity: 'medium',
    details: {
      key,
      limit,
      retryAfterSeconds,
    },
  });
}

/**
 * Log suspicious authentication activity
 */
export async function auditLogAuthAttempt(
  email: string,
  success: boolean,
  failureReason?: string,
  context?: {
    userId?: string;
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await auditLog({
    action: success ? 'AUTH_SUCCESS' : 'AUTH_FAILED',
    userId: context?.userId,
    ip: context?.ip,
    userAgent: context?.userAgent,
    severity: success ? 'low' : 'medium',
    details: {
      email,
      failureReason,
    },
  });
}

/**
 * Log sensitive operations (data export, account deletion, etc.)
 */
export async function auditLogSensitiveOperation(
  operation: string,
  userId: string,
  details?: Record<string, unknown>,
  context?: {
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await auditLog({
    action: `SENSITIVE_OPERATION_${operation.toUpperCase()}`,
    userId,
    ip: context?.ip,
    userAgent: context?.userAgent,
    severity: 'high',
    details,
  });
}

/**
 * Log admin action
 */
export async function auditLogAdminAction(
  adminId: string,
  action: string,
  targetId?: string,
  details?: Record<string, unknown>,
  context?: {
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await auditLog({
    action: `ADMIN_${action.toUpperCase()}`,
    userId: adminId,
    ip: context?.ip,
    userAgent: context?.userAgent,
    severity: 'high',
    details: {
      targetId,
      ...details,
    },
  });
}
