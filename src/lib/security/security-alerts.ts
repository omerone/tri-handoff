import 'server-only';
import {
  countAdminActionsByAdmin,
  countAuthEventsByUser,
  findUserEmails,
  listLargeExports,
} from '@/lib/db/security-events';

/**
 * Security Monitoring & Alerting System
 *
 * Monitors for suspicious activity and triggers alerts via Slack webhook.
 * Alert conditions:
 * - Multiple failed login attempts (>5 in 30 minutes)
 * - Mass data exports (>1000 records in single session)
 * - Admin actions on user accounts
 * - Unusual API access patterns
 */

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SecurityAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  affectedUsers: string[];
  metadata: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Configuration for security alerts
 */
const ALERT_CONFIG = {
  failedLogins: {
    threshold: 5,
    windowMinutes: 30,
    severity: 'high' as AlertSeverity,
  },
  dataExport: {
    threshold: 1000,
    windowMinutes: 60,
    severity: 'high' as AlertSeverity,
  },
  adminActions: {
    threshold: 10,
    windowMinutes: 60,
    severity: 'medium' as AlertSeverity,
  },
  passwordReset: {
    threshold: 3,
    windowMinutes: 30,
    severity: 'medium' as AlertSeverity,
  },
};

/**
 * Check for suspicious login attempts
 * Alert if >5 failed logins in 30 minutes for a single user
 */
export async function checkFailedLogins(): Promise<SecurityAlert[]> {
  const alerts: SecurityAlert[] = [];
  const windowStart = new Date(Date.now() - ALERT_CONFIG.failedLogins.windowMinutes * 60 * 1000);

  // Group failed login attempts by user
  const failedLogins = await countAuthEventsByUser({
    eventType: 'login_failed',
    result: 'failure',
    since: windowStart,
  });

  const breaching = failedLogins.filter(
    (record) => record.count >= ALERT_CONFIG.failedLogins.threshold,
  );
  // One lookup for the whole batch rather than one per alert — see `findUserEmails`.
  const emails = await findUserEmails(breaching.map((record) => record.userId));

  for (const record of breaching) {
    const email = emails.get(record.userId);

    alerts.push({
      id: `failed-logins-${record.userId}`,
      type: 'failed_logins',
      severity: ALERT_CONFIG.failedLogins.severity,
      title: `Multiple Failed Login Attempts`,
      description: `User ${email || record.userId} had ${record.count} failed login attempts in the last 30 minutes`,
      affectedUsers: [record.userId],
      metadata: {
        failedAttempts: record.count,
        userId: record.userId,
        email,
      },
      timestamp: new Date(),
    });
  }

  return alerts;
}

/**
 * Check for mass data exports
 * Alert if >1000 records exported in single session
 */
export async function checkMassDataExport(): Promise<SecurityAlert[]> {
  const alerts: SecurityAlert[] = [];
  const windowStart = new Date(Date.now() - ALERT_CONFIG.dataExport.windowMinutes * 60 * 1000);

  const exports = await listLargeExports({
    since: windowStart,
    minRecords: ALERT_CONFIG.dataExport.threshold,
  });

  const emails = await findUserEmails(exports.map((exp) => exp.userId));

  for (const exp of exports) {
    const email = emails.get(exp.userId);

    alerts.push({
      id: `mass-export-${exp.id}`,
      type: 'mass_data_export',
      severity: ALERT_CONFIG.dataExport.severity,
      title: `Large Data Export Detected`,
      description: `User ${email || exp.userId} exported ${exp.recordCount} ${exp.resource} records at ${exp.createdAt.toISOString()}`,
      affectedUsers: [exp.userId],
      metadata: {
        recordCount: exp.recordCount,
        resource: exp.resource,
        userId: exp.userId,
        email,
      },
      timestamp: exp.createdAt,
    });
  }

  return alerts;
}

/**
 * Check for suspicious admin activity
 * Alert if >10 admin actions in 1 hour
 */
export async function checkAdminActivity(): Promise<SecurityAlert[]> {
  const alerts: SecurityAlert[] = [];
  const windowStart = new Date(Date.now() - ALERT_CONFIG.adminActions.windowMinutes * 60 * 1000);

  const adminActions = await countAdminActionsByAdmin({ since: windowStart });

  for (const record of adminActions) {
    if (record.count >= ALERT_CONFIG.adminActions.threshold && record.adminId) {
      alerts.push({
        id: `admin-activity-${record.adminId}`,
        type: 'high_admin_activity',
        severity: ALERT_CONFIG.adminActions.severity,
        title: `High Admin Activity Detected`,
        description: `Admin ${record.adminId} performed ${record.count} actions in the last 60 minutes`,
        affectedUsers: [],
        metadata: {
          adminId: record.adminId,
          actionCount: record.count,
        },
        timestamp: new Date(),
      });
    }
  }

  return alerts;
}

/**
 * Check for suspicious password reset attempts
 * Alert if >3 password resets in 30 minutes for a user
 */
export async function checkPasswordResetAttempts(): Promise<SecurityAlert[]> {
  const alerts: SecurityAlert[] = [];
  const windowStart = new Date(Date.now() - ALERT_CONFIG.passwordReset.windowMinutes * 60 * 1000);

  const resetAttempts = await countAuthEventsByUser({
    eventType: 'password_reset_requested',
    since: windowStart,
  });

  const breaching = resetAttempts.filter(
    (record) => record.count >= ALERT_CONFIG.passwordReset.threshold,
  );
  const emails = await findUserEmails(breaching.map((record) => record.userId));

  for (const record of breaching) {
    const email = emails.get(record.userId);

    alerts.push({
      id: `password-reset-${record.userId}`,
      type: 'password_reset_attempts',
      severity: ALERT_CONFIG.passwordReset.severity,
      title: `Multiple Password Reset Attempts`,
      description: `User ${email || record.userId} requested ${record.count} password resets in the last 30 minutes`,
      affectedUsers: [record.userId],
      metadata: {
        attempts: record.count,
        userId: record.userId,
        email,
      },
      timestamp: new Date(),
    });
  }

  return alerts;
}

/**
 * Send alert to Slack webhook (if configured)
 * Configuration via environment variable: SECURITY_ALERTS_SLACK_WEBHOOK
 */
export async function sendSlackAlert(alert: SecurityAlert): Promise<boolean> {
  const webhookUrl = process.env.SECURITY_ALERTS_SLACK_WEBHOOK;

  if (!webhookUrl) {
    console.warn('[SECURITY] Alert detected but SECURITY_ALERTS_SLACK_WEBHOOK not configured:', {
      type: alert.type,
      title: alert.title,
    });
    return false;
  }

  try {
    const severityEmoji = {
      low: ':yellow_circle:',
      medium: ':orange_circle:',
      high: ':red_circle:',
      critical: ':fire:',
    }[alert.severity];

    const payload = {
      text: `${severityEmoji} Security Alert: ${alert.title}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${severityEmoji} ${alert.title}`,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Type:*\n${alert.type}`,
            },
            {
              type: 'mrkdwn',
              text: `*Severity:*\n${alert.severity}`,
            },
            {
              type: 'mrkdwn',
              text: `*Description:*\n${alert.description}`,
            },
            {
              type: 'mrkdwn',
              text: `*Time:*\n${alert.timestamp.toISOString()}`,
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Affected users: ${alert.affectedUsers.length > 0 ? alert.affectedUsers.join(', ') : 'None'}`,
            },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('[SECURITY] Failed to send Slack alert:', {
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    return true;
  } catch (error) {
    console.error('[SECURITY] Error sending Slack alert:', error);
    return false;
  }
}

/**
 * Run all security checks and send alerts for findings
 * Should be called periodically (e.g., every 5 minutes) via a cron job
 */
export async function runSecurityChecks(): Promise<SecurityAlert[]> {
  const allAlerts: SecurityAlert[] = [];

  try {
    // Run all alert checks in parallel
    const [
      failedLoginAlerts,
      dataExportAlerts,
      adminActivityAlerts,
      passwordResetAlerts,
    ] = await Promise.all([
      checkFailedLogins(),
      checkMassDataExport(),
      checkAdminActivity(),
      checkPasswordResetAttempts(),
    ]);

    allAlerts.push(
      ...failedLoginAlerts,
      ...dataExportAlerts,
      ...adminActivityAlerts,
      ...passwordResetAlerts
    );

    // Send alerts if any found
    for (const alert of allAlerts) {
      await sendSlackAlert(alert);
    }

    return allAlerts;
  } catch (error) {
    console.error('[SECURITY] Error running security checks:', error);
    return [];
  }
}
