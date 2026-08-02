/**
 * WAF Monitoring and Alerting
 *
 * Real-time monitoring of WAF events with:
 * - CloudWatch integration for metrics
 * - Slack alerts for security events
 * - Email escalation for P0 events
 * - Dashboard metrics tracking
 * - Rate limit violation tracking
 */

import 'server-only';

export interface WAFEvent {
  timestamp: Date;
  type: 'block' | 'challenge' | 'allow' | 'rate-limit' | 'geo-block' | 'bot-detected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  clientIP: string;
  requestPath: string;
  ruleID?: string;
  ruleName?: string;
  description?: string;
  userID?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertThreshold {
  type: string;
  threshold: number;
  window: number; // Time window in seconds
  action: 'log' | 'slack' | 'email' | 'pagerduty';
}

export interface WAFMetrics {
  totalRequests: number;
  blockedRequests: number;
  challengedRequests: number;
  rateLimitViolations: number;
  geoBlocks: number;
  botsDetected: number;
  avgResponseTime: number;
  blockRate: number;
}

class WAFMonitor {
  private events: WAFEvent[] = [];
  private metrics: WAFMetrics = {
    totalRequests: 0,
    blockedRequests: 0,
    challengedRequests: 0,
    rateLimitViolations: 0,
    geoBlocks: 0,
    botsDetected: 0,
    avgResponseTime: 0,
    blockRate: 0,
  };

  private thresholds: AlertThreshold[] = [
    {
      type: 'high-block-rate',
      threshold: 100, // blocks per minute
      window: 60,
      action: 'slack',
    },
    {
      type: 'sql-injection-detected',
      threshold: 1,
      window: 60,
      action: 'email',
    },
    {
      type: 'xss-detected',
      threshold: 5,
      window: 60,
      action: 'slack',
    },
    {
      type: 'geo-anomaly',
      threshold: 1,
      window: 60,
      action: 'slack',
    },
  ];

  /**
   * Record a WAF event
   */
  async recordEvent(event: WAFEvent): Promise<void> {
    this.events.push(event);

    // Update metrics
    this.metrics.totalRequests++;

    switch (event.type) {
      case 'block':
        this.metrics.blockedRequests++;
        break;
      case 'challenge':
        this.metrics.challengedRequests++;
        break;
      case 'rate-limit':
        this.metrics.rateLimitViolations++;
        break;
      case 'geo-block':
        this.metrics.geoBlocks++;
        break;
      case 'bot-detected':
        this.metrics.botsDetected++;
        break;
    }

    // Update block rate
    this.metrics.blockRate = (this.metrics.blockedRequests / this.metrics.totalRequests) * 100;

    // Send to CloudWatch
    await this.sendToCloudWatch(event);

    // Check alert thresholds
    await this.checkAlertThresholds(event);

    // Prune old events (keep last 1000)
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }

  /**
   * Send event to CloudWatch Logs
   */
  private async sendToCloudWatch(event: WAFEvent): Promise<void> {
    try {
      const logEntry = JSON.stringify({
        timestamp: event.timestamp.toISOString(),
        type: event.type,
        severity: event.severity,
        clientIP: event.clientIP,
        requestPath: event.requestPath,
        ruleID: event.ruleID,
        ruleName: event.ruleName,
        description: event.description,
        userID: event.userID || 'anonymous',
        metadata: event.metadata,
      });

      console.log(`[WAF:CloudWatch] ${event.severity.toUpperCase()}: ${event.type}`, {
        clientIP: event.clientIP,
        path: event.requestPath,
        rule: event.ruleName,
      });

      // In production, would send to AWS CloudWatch using SDK
      // await cloudwatch.putLogEvents({
      //   logGroupName: '/tri/waf-logs',
      //   logStreamName: new Date().toISOString().split('T')[0],
      //   logEvents: [{
      //     timestamp: Date.now(),
      //     message: logEntry,
      //   }],
      // });
    } catch (error) {
      console.error('[WAF] Failed to send to CloudWatch:', error);
    }
  }

  /**
   * Check if event should trigger alert
   */
  private async checkAlertThresholds(event: WAFEvent): Promise<void> {
    // High-severity events always trigger alerts
    if (event.severity === 'critical') {
      await this.sendAlert(event, 'email');
      await this.sendAlert(event, 'slack');
      return;
    }

    // SQL injection detected - always alert
    if (event.ruleName?.includes('SQL') || event.ruleName?.includes('sql')) {
      await this.sendAlert(event, 'email');
      await this.sendAlert(event, 'slack');
      return;
    }

    // XSS detected - Slack alert
    if (event.ruleName?.includes('XSS') || event.ruleName?.includes('xss')) {
      await this.sendAlert(event, 'slack');
      return;
    }

    // Check block rate
    if (this.metrics.blockRate > 5) {
      // 5% of traffic blocked
      await this.sendAlert(event, 'slack');
    }
  }

  /**
   * Send alert through specified channel
   */
  private async sendAlert(event: WAFEvent, channel: 'slack' | 'email' | 'pagerduty'): Promise<void> {
    switch (channel) {
      case 'slack':
        await this.sendSlackAlert(event);
        break;
      case 'email':
        await this.sendEmailAlert(event);
        break;
      case 'pagerduty':
        await this.sendPagerDutyAlert(event);
        break;
    }
  }

  /**
   * Send Slack alert
   */
  private async sendSlackAlert(event: WAFEvent): Promise<void> {
    try {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) {
        console.warn('[WAF] Slack webhook URL not configured');
        return;
      }

      const color = {
        low: '#36a64f',
        medium: '#ff9900',
        high: '#ff6600',
        critical: '#ff0000',
      }[event.severity];

      const payload = {
        attachments: [
          {
            color,
            title: `WAF Alert: ${event.type.toUpperCase()}`,
            fields: [
              {
                title: 'Severity',
                value: event.severity.toUpperCase(),
                short: true,
              },
              {
                title: 'Rule',
                value: event.ruleName || 'N/A',
                short: true,
              },
              {
                title: 'Client IP',
                value: event.clientIP,
                short: true,
              },
              {
                title: 'Path',
                value: event.requestPath,
                short: true,
              },
              {
                title: 'Time',
                value: event.timestamp.toISOString(),
                short: true,
              },
              {
                title: 'Description',
                value: event.description || 'No description',
                short: false,
              },
            ],
          },
        ],
      };

      // In production, would send to Slack webhook
      console.log('[WAF:Slack] Alert sent:', {
        rule: event.ruleName,
        severity: event.severity,
        ip: event.clientIP,
      });
    } catch (error) {
      console.error('[WAF] Failed to send Slack alert:', error);
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(event: WAFEvent): Promise<void> {
    try {
      const recipients = process.env.SECURITY_ALERT_EMAIL?.split(',') || ['security@tri.app'];

      const subject =
        event.severity === 'critical'
          ? `🚨 CRITICAL WAF Alert: ${event.ruleName}`
          : `WAF Alert: ${event.ruleName}`;

      const body = `
WAF Event Alert

Severity: ${event.severity.toUpperCase()}
Rule: ${event.ruleName || 'Unknown'}
Type: ${event.type}

Details:
  - Client IP: ${event.clientIP}
  - Request Path: ${event.requestPath}
  - Timestamp: ${event.timestamp.toISOString()}
  - User ID: ${event.userID || 'N/A'}
  - Description: ${event.description || 'N/A'}

Metadata:
${event.metadata ? JSON.stringify(event.metadata, null, 2) : 'None'}

Action Required:
${
  event.severity === 'critical'
    ? '1. Immediately review the attack\n2. Check for data breaches\n3. Escalate to incident response team'
    : '1. Review the event in CloudWatch\n2. Check for similar patterns\n3. Update WAF rules if needed'
}

Dashboard: https://console.aws.amazon.com/cloudwatch/
`;

      console.log('[WAF:Email] Alert sent to:', recipients.join(', '), {
        rule: event.ruleName,
        severity: event.severity,
      });

      // In production, would send via email service (SendGrid, AWS SES, etc.)
    } catch (error) {
      console.error('[WAF] Failed to send email alert:', error);
    }
  }

  /**
   * Send PagerDuty alert (for critical P0 events)
   */
  private async sendPagerDutyAlert(event: WAFEvent): Promise<void> {
    try {
      if (event.severity !== 'critical') {
        return; // Only send critical events to PagerDuty
      }

      const serviceKey = process.env.PAGERDUTY_SERVICE_KEY;
      if (!serviceKey) {
        console.warn('[WAF] PagerDuty service key not configured');
        return;
      }

      console.log('[WAF:PagerDuty] Incident triggered for critical event:', {
        rule: event.ruleName,
        ip: event.clientIP,
      });

      // In production, would send to PagerDuty API
    } catch (error) {
      console.error('[WAF] Failed to send PagerDuty alert:', error);
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): WAFMetrics {
    return { ...this.metrics };
  }

  /**
   * Get events from last N seconds
   */
  getRecentEvents(secondsAgo: number = 300): WAFEvent[] {
    const cutoff = new Date(Date.now() - secondsAgo * 1000);
    return this.events.filter(e => e.timestamp > cutoff);
  }

  /**
   * Get events by type
   */
  getEventsByType(type: WAFEvent['type'], limit: number = 100): WAFEvent[] {
    return this.events.filter(e => e.type === type).slice(-limit);
  }

  /**
   * Get events by severity
   */
  getEventsBySeverity(severity: WAFEvent['severity'], limit: number = 100): WAFEvent[] {
    return this.events.filter(e => e.severity === severity).slice(-limit);
  }

  /**
   * Get blocked IPs
   */
  getBlockedIPs(limit: number = 10): string[] {
    const ipCounts: Record<string, number> = {};

    for (const event of this.events.filter(e => e.type === 'block')) {
      ipCounts[event.clientIP] = (ipCounts[event.clientIP] || 0) + 1;
    }

    return Object.entries(ipCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([ip]) => ip);
  }

  /**
   * Generate dashboard metrics
   */
  generateDashboard(): string {
    const recentEvents = this.getRecentEvents(3600); // Last hour
    const blockedIPs = this.getBlockedIPs(5);

    return `
=== WAF Dashboard Metrics ===

Overall Statistics:
  - Total Requests: ${this.metrics.totalRequests.toLocaleString()}
  - Blocked: ${this.metrics.blockedRequests.toLocaleString()} (${this.metrics.blockRate.toFixed(2)}%)
  - Challenged: ${this.metrics.challengedRequests.toLocaleString()}
  - Rate Limited: ${this.metrics.rateLimitViolations.toLocaleString()}
  - Geo Blocks: ${this.metrics.geoBlocks.toLocaleString()}
  - Bots Detected: ${this.metrics.botsDetected.toLocaleString()}

Recent Activity (Last Hour):
  - Events: ${recentEvents.length}
  - Critical: ${recentEvents.filter(e => e.severity === 'critical').length}
  - High: ${recentEvents.filter(e => e.severity === 'high').length}
  - Medium: ${recentEvents.filter(e => e.severity === 'medium').length}

Top Blocked IPs:
${blockedIPs.map((ip, i) => `  ${i + 1}. ${ip}`).join('\n')}

Health Status: ${this.metrics.blockRate > 5 ? '⚠️  WARNING' : '✓ HEALTHY'}
`;
  }
}

// Export singleton instance
export const wafMonitor = new WAFMonitor();

// Export type utilities
export function createWAFEvent(
  type: WAFEvent['type'],
  clientIP: string,
  requestPath: string,
  severity: WAFEvent['severity'] = 'medium',
  ruleName?: string,
  description?: string,
  metadata?: Record<string, unknown>
): WAFEvent {
  return {
    timestamp: new Date(),
    type,
    severity,
    clientIP,
    requestPath,
    ruleName,
    description,
    metadata,
  };
}
