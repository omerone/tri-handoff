import 'server-only';
import {
  countRecentAuthEvents,
  recordAdminAction,
  recordAuthEvent,
  recordDataAccess,
} from '@/lib/db/security-events';
import { headers } from 'next/headers';

/**
 * Security Event Logger
 *
 * Centralized logging for security-relevant events:
 * - Authentication (login, password changes, sessions)
 * - Data access (exports, profile changes)
 * - Admin actions (user management, configuration changes)
 *
 * All events include:
 * - Timestamp (automatic)
 * - IP address (from X-Forwarded-For or connection IP)
 * - User agent (browser/client identifier)
 * - User ID (who performed the action)
 *
 * Events are stored in database for:
 * - Real-time alerting (on failed logins, data exports)
 * - Compliance & audit trails (GDPR, tax, SOX if applicable)
 * - Forensic investigation (breach analysis)
 * - Retention: 12 months (auto-deleted by cleanup job)
 */

/** What a Json column can actually hold. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * `null` rather than `undefined`: these go straight into nullable columns, and a request with
 * no `X-Forwarded-For` should record "no address known" rather than leave the column to
 * Prisma's default.
 */
interface LoggerContext {
  userId?: string;
  ipAddress: string | null;
  userAgent: string | null;
}

class SecurityLogger {
  /**
   * Log authentication event (login success/failure, password change)
   * Used for: rate limiting, breach investigation, account security
   */
  static async logAuthEvent(opts: {
    userId: string;
    eventType: string; // 'login_success', 'login_failed', 'password_changed', etc.
    description: string;
    result?: 'success' | 'failure' | 'blocked';
    failureReason?: string; // e.g., 'wrong_password', 'account_locked', 'rate_limited'
  }): Promise<void> {
    try {
      const context = await getContext();

      await recordAuthEvent({
        userId: opts.userId,
        eventType: opts.eventType,
        description: opts.description,
        result: opts.result ?? 'success',
        details: opts.failureReason ? { failureReason: opts.failureReason } : undefined,
        context,
      });

      // Alert on suspicious activity: too many failed logins
      if (opts.result === 'failure' || opts.result === 'blocked') {
        await this.checkFailedLoginThreshold(opts.userId);
      }
    } catch (err) {
      // Logging failure should not crash the app
      console.error('Failed to log auth event:', err);
    }
  }

  /**
   * Log data access event (profile changes, data exports, analytics queries)
   * Used for: GDPR compliance, data governance, breach investigation
   */
  static async logDataAccess(opts: {
    userId: string;
    action: string; // 'export', 'profile_view', 'trades_export', 'sync', etc.
    resource: string; // 'user_profile', 'trades', 'finance', 'mt5_account', etc.
    recordCount?: number;
    dataSizeBytes?: number;
  }): Promise<void> {
    try {
      const context = await getContext();

      await recordDataAccess({
        userId: opts.userId,
        action: opts.action,
        resource: opts.resource,
        recordCount: opts.recordCount,
        dataSizeBytes: opts.dataSizeBytes,
        ipAddress: context.ipAddress,
      });

      // Alert on large exports (data exfiltration detection)
      if (opts.dataSizeBytes && opts.dataSizeBytes > 10_000_000) {
        // 10 MB
        console.warn(
          `Large data export: user ${opts.userId} exported ${opts.dataSizeBytes} bytes`
        );
      }
    } catch (err) {
      console.error('Failed to log data access event:', err);
    }
  }

  /**
   * Log admin action (tenant/user management, configuration changes)
   * Used for: compliance, audit trail, change management
   */
  static async logAdminAction(opts: {
    adminId?: string;
    tenantId?: string;
    userId?: string;
    actionType: string; // 'create_tenant', 'reset_password', 'suspend_user', etc.
    description: string;
    /**
     * Field-level changes. Typed as JSON rather than `unknown`, because this lands in a Json
     * column: `unknown` let a caller pass a Date or a class instance, which Prisma rejects at
     * the type level and which would have been silently mangled had it not.
     */
    changes?: Record<string, { from?: JsonValue; to: JsonValue }>;
  }): Promise<void> {
    try {
      const context = await getContext();

      await recordAdminAction({
        adminId: opts.adminId,
        tenantId: opts.tenantId,
        userId: opts.userId,
        actionType: opts.actionType,
        description: opts.description,
        changes: opts.changes,
        context,
      });
    } catch (err) {
      console.error('Failed to log admin action:', err);
    }
  }

  /**
   * Alert helper: check if user has too many failed login attempts
   * Threshold: 5 failed logins in 30 minutes
   *
   * Future: could send email alert or page on-call
   */
  private static async checkFailedLoginThreshold(userId: string): Promise<void> {
    try {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      const failedCount = await countRecentAuthEvents({
        userId,
        eventType: 'login_failed',
        since: thirtyMinutesAgo,
      });

      if (failedCount >= 5) {
        console.error(
          `SECURITY ALERT: User ${userId} has ${failedCount} failed logins in 30 minutes`
        );
        // TODO: Send alert email, page on-call team, disable account
      }
    } catch (err) {
      console.error('Failed to check login threshold:', err);
    }
  }
}

/**
 * Helper function to extract IP from request headers
 * Used internally by SecurityLogger
 */
async function getContext(): Promise<LoggerContext> {
  const headerStore = await headers();
  return {
    ipAddress: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerStore.get('user-agent')?.slice(0, 300) ?? null,
  };
}

export { SecurityLogger };
