/**
 * Rate Limit Monitoring & Alerting
 *
 * Tracks rate limit metrics and sends alerts for suspicious patterns.
 * Designed to integrate with monitoring services (Datadog, NewRelic, etc.)
 */

import 'server-only';

export interface RateLimitMetrics {
  timestamp: Date;
  endpoint: string;
  totalRequests: number;
  blockedRequests: number;
  blockRate: number; // percentage
  topViolators: Array<{
    key: string;
    violations: number;
  }>;
  averageLatencyMs: number;
}

export interface AlertCondition {
  name: string;
  check: (metrics: RateLimitMetrics) => boolean;
  severity: 'info' | 'warning' | 'critical';
  message: (metrics: RateLimitMetrics) => string;
}

// In-memory metrics storage (for single-instance or debugging)
const metricsStorage = new Map<string, RateLimitMetrics[]>();
const violatorTracking = new Map<string, number>();

/**
 * Record a rate limit block
 */
export async function recordRateLimitBlock(
  endpoint: string,
  key: string,
  latencyMs: number
): Promise<void> {
  try {
    // Track endpoint metrics
    const metricsKey = `endpoint:${endpoint}`;
    if (!metricsStorage.has(metricsKey)) {
      metricsStorage.set(metricsKey, []);
    }

    // Track violator (for top offenders)
    violatorTracking.set(key, (violatorTracking.get(key) || 0) + 1);

    // Send to monitoring service
    if (process.env.MONITORING_ENDPOINT) {
      await sendMetricToMonitoring({
        metric: 'rate_limit_block',
        tags: {
          endpoint,
          key,
        },
        value: 1,
        timestamp: Date.now(),
      });
    }

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[RateLimit] Block on ${endpoint}: ${key}`);
    }
  } catch (error) {
    console.error('[RateLimit] Failed to record block:', error);
  }
}

/**
 * Record a successful request (for calculating block rate)
 */
export async function recordSuccessfulRequest(
  endpoint: string,
  latencyMs: number
): Promise<void> {
  try {
    // Send to monitoring service
    if (process.env.MONITORING_ENDPOINT) {
      await sendMetricToMonitoring({
        metric: 'request_success',
        tags: {
          endpoint,
        },
        value: 1,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error('[RateLimit] Failed to record success:', error);
  }
}

/**
 * Get current metrics for an endpoint
 */
export function getEndpointMetrics(endpoint: string): RateLimitMetrics | null {
  const metricsKey = `endpoint:${endpoint}`;
  const metrics = metricsStorage.get(metricsKey);

  if (!metrics || metrics.length === 0) {
    return null;
  }

  // Get latest metrics
  return metrics[metrics.length - 1] || null;
}

/**
 * Get top violators (IPs or users generating most blocks)
 */
export function getTopViolators(limit: number = 10): Array<{
  key: string;
  violations: number;
}> {
  return Array.from(violatorTracking.entries())
    .map(([key, violations]) => ({ key, violations }))
    .sort((a, b) => b.violations - a.violations)
    .slice(0, limit);
}

/**
 * Alert conditions to check
 */
export const ALERT_CONDITIONS: AlertCondition[] = [
  {
    name: 'HIGH_BLOCK_RATE',
    check: (metrics) => metrics.blockRate > 50,
    severity: 'critical',
    message: (metrics) => `High block rate (${metrics.blockRate}%) on ${metrics.endpoint}`,
  },
  {
    name: 'SPIKE_IN_BLOCKS',
    check: (metrics) => metrics.blockedRequests > 1000,
    severity: 'warning',
    message: (metrics) =>
      `Spike in blocks: ${metrics.blockedRequests} blocked requests on ${metrics.endpoint}`,
  },
  {
    name: 'SINGLE_IP_ATTACK',
    check: (metrics) => {
      // Check if single IP is generating >10% of all traffic
      const topViolators = getTopViolators(1);
      return topViolators[0] && topViolators[0].violations > metrics.totalRequests * 0.1;
    },
    severity: 'high',
    message: (metrics) => {
      const topViolators = getTopViolators(1);
      return `Potential attack from ${topViolators[0]?.key}: ${topViolators[0]?.violations} violations`;
    },
  },
];

/**
 * Check alert conditions and return triggered alerts
 */
export async function checkAlertConditions(
  endpoint: string
): Promise<
  Array<{
    condition: string;
    severity: string;
    message: string;
  }>
> {
  const metrics = getEndpointMetrics(endpoint);
  if (!metrics) {
    return [];
  }

  const alerts: Array<{
    condition: string;
    severity: string;
    message: string;
  }> = [];

  for (const condition of ALERT_CONDITIONS) {
    if (condition.check(metrics)) {
      const alert = {
        condition: condition.name,
        severity: condition.severity,
        message: condition.message(metrics),
      };

      alerts.push(alert);

      // Send alert to Slack if configured
      if (process.env.SLACK_WEBHOOK_URL) {
        await sendSlackAlert(alert);
      }
    }
  }

  return alerts;
}

/**
 * Send metric to monitoring service
 */
async function sendMetricToMonitoring(metric: {
  metric: string;
  tags: Record<string, string>;
  value: number;
  timestamp: number;
}): Promise<void> {
  try {
    if (!process.env.MONITORING_ENDPOINT) {
      return;
    }

    const response = await fetch(process.env.MONITORING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MONITORING_API_KEY}`,
      },
      body: JSON.stringify(metric),
    });

    if (!response.ok) {
      console.error('[Monitoring] Failed to send metric:', response.statusText);
    }
  } catch (error) {
    console.error('[Monitoring] Error sending metric:', error);
  }
}

/**
 * Send alert to Slack
 */
async function sendSlackAlert(alert: {
  condition: string;
  severity: string;
  message: string;
}): Promise<void> {
  try {
    if (!process.env.SLACK_WEBHOOK_URL) {
      return;
    }

    const color = {
      info: '#36a64f',
      warning: '#ff9800',
      critical: '#f44336',
    }[alert.severity] || '#999999';

    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          {
            color,
            title: `Rate Limit Alert: ${alert.condition}`,
            text: alert.message,
            footer: 'TRi Rate Limit Monitoring',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send alert:', response.statusText);
    }
  } catch (error) {
    console.error('[Slack] Error sending alert:', error);
  }
}

/**
 * Cleanup old metrics (keep only last 24 hours)
 */
export function cleanupOldMetrics(): void {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  for (const [key, metrics] of metricsStorage.entries()) {
    const filtered = metrics.filter((m) => m.timestamp.getTime() > oneDayAgo);
    if (filtered.length === 0) {
      metricsStorage.delete(key);
    } else {
      metricsStorage.set(key, filtered);
    }
  }
}

/**
 * Reset metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsStorage.clear();
  violatorTracking.clear();
}

// Cleanup old metrics every hour
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupOldMetrics, 60 * 60 * 1000);
}
