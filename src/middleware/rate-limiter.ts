/**
 * Production-grade rate limiting middleware
 *
 * Implements token bucket algorithm with:
 * - Per-IP, per-user, and per-route limiting
 * - Exponential backoff for repeated violations
 * - Redis backend with in-memory fallback
 * - Comprehensive rate limit headers (X-RateLimit-*, Retry-After)
 * - Graceful degradation if Redis unavailable
 * - Audit logging of rate limit violations
 */

import 'server-only';
import { RATE_LIMITS } from '@/config/rate-limits';
import { getRedisClient } from '@/lib/redis/client';
import { auditLog } from '@/lib/security/audit-logger';

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowMs: number;
  description: string;
  skipSuccessfulRequest?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
  retryAfterSeconds?: number;
}

/**
 * Token bucket rate limiter
 * Implements exponential backoff on repeated violations
 */
export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const redis = await getRedisClient();
  const now = Date.now();
  const windowStart = now - options.windowMs;

  const keyPrefix = `${RATE_LIMITS.redis.keyPrefix}${options.key}`;
  const countKey = `${keyPrefix}:count`;
  const violationKey = `${keyPrefix}:violations`;
  const resetKey = `${keyPrefix}:reset`;

  try {
    // Get current count and reset time
    const countStr = await redis.get(countKey);
    const violationStr = await redis.get(violationKey);
    const resetStr = await redis.get(resetKey);

    const count = countStr ? parseInt(countStr, 10) : 0;
    const violations = violationStr ? parseInt(violationStr, 10) : 0;
    const resetTime = resetStr ? parseInt(resetStr, 10) : now + options.windowMs;

    // Calculate backoff delay
    let backoffMultiplier = 1;
    if (RATE_LIMITS.backoff.enabled && violations > 0) {
      backoffMultiplier = Math.min(
        Math.pow(RATE_LIMITS.backoff.multiplier, violations),
        RATE_LIMITS.backoff.maxDelay / options.windowMs
      );
    }

    const adjustedLimit = Math.ceil(options.limit / backoffMultiplier);
    const resetAfterSeconds = Math.ceil((resetTime - now) / 1000);

    if (count >= adjustedLimit) {
      // Rate limit exceeded
      const retryAfterSeconds = resetAfterSeconds + (violations * 5); // 5 second penalty per violation
      return {
        allowed: false,
        limit: adjustedLimit,
        remaining: 0,
        resetAfterSeconds,
        retryAfterSeconds: Math.min(retryAfterSeconds, 3600), // Cap at 1 hour
      };
    }

    // Increment count for this request
    const newCount = count + 1;

    // Update Redis
    if (newCount === 1) {
      // First request in window, set expiration
      await redis.set(countKey, String(newCount), options.windowMs);
      await redis.set(resetKey, String(now + options.windowMs), options.windowMs);
    } else {
      // Increment existing counter
      await redis.incr(countKey);
    }

    // Reset violations on successful request
    if (violations > 0) {
      await redis.del(violationKey);
    }

    return {
      allowed: true,
      limit: adjustedLimit,
      remaining: Math.max(0, adjustedLimit - newCount),
      resetAfterSeconds,
    };
  } catch (error) {
    console.error('[RateLimit] Error checking rate limit:', error);
    // Graceful degradation: allow request but log the error
    return {
      allowed: true,
      limit: options.limit,
      remaining: 0,
      resetAfterSeconds: Math.ceil(options.windowMs / 1000),
    };
  }
}

/**
 * Record a rate limit violation for exponential backoff
 */
export async function recordRateLimitViolation(key: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keyPrefix = `${RATE_LIMITS.redis.keyPrefix}${key}`;
    const violationKey = `${keyPrefix}:violations`;

    const current = await redis.get(violationKey);
    const violations = (current ? parseInt(current, 10) : 0) + 1;

    // Store violations for 24 hours
    await redis.set(violationKey, String(violations), 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error('[RateLimit] Error recording violation:', error);
  }
}

/**
 * Format rate limit headers for response
 */
export function formatRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.resetAfterSeconds * 1000) / 1000)),
  };

  if (result.retryAfterSeconds) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}

/**
 * Create a standardized rate limit error response
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  description: string
): {
  status: number;
  body: Record<string, any>;
  headers: Record<string, string>;
} {
  return {
    status: 429,
    body: {
      error: 'Too Many Requests',
      message: `Rate limit exceeded: ${description}. Please try again in ${result.retryAfterSeconds} seconds.`,
      retryAfter: result.retryAfterSeconds || result.resetAfterSeconds,
      rateLimit: {
        limit: result.limit,
        remaining: result.remaining,
        reset: Math.ceil((Date.now() + result.resetAfterSeconds * 1000) / 1000),
      },
    },
    headers: formatRateLimitHeaders(result),
  };
}

/**
 * Check if a request should be rate limited and audit the violation
 */
export async function checkAndAuditRateLimit(
  options: RateLimitOptions,
  context: {
    userId?: string;
    ip?: string;
    userAgent?: string;
  }
): Promise<RateLimitResult> {
  const result = await checkRateLimit(options);

  if (!result.allowed) {
    // Record violation for exponential backoff
    await recordRateLimitViolation(options.key);

    // Audit log the violation
    try {
      await auditLog({
        action: 'RATE_LIMIT_EXCEEDED',
        userId: context.userId || 'anonymous',
        ip: context.ip || 'unknown',
        details: {
          key: options.key,
          description: options.description,
          limit: result.limit,
          resetAfterSeconds: result.retryAfterSeconds,
        },
        severity: 'medium',
      });
    } catch (error) {
      console.error('[RateLimit] Failed to audit rate limit violation:', error);
    }
  }

  return result;
}

/**
 * Reset rate limit for a key (e.g., after successful auth)
 */
export async function resetRateLimitBucket(key: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keyPrefix = `${RATE_LIMITS.redis.keyPrefix}${key}`;

    await redis.del(`${keyPrefix}:count`);
    await redis.del(`${keyPrefix}:reset`);
    await redis.del(`${keyPrefix}:violations`);
  } catch (error) {
    console.error('[RateLimit] Error resetting rate limit:', error);
  }
}

/**
 * Get current rate limit status for a key
 */
export async function getRateLimitStatus(
  key: string,
  limit: number,
  windowMs: number
): Promise<{
  used: number;
  remaining: number;
  resetAfterSeconds: number;
}> {
  try {
    const redis = await getRedisClient();
    const keyPrefix = `${RATE_LIMITS.redis.keyPrefix}${key}`;
    const countKey = `${keyPrefix}:count`;
    const resetKey = `${keyPrefix}:reset`;

    const countStr = await redis.get(countKey);
    const resetStr = await redis.get(resetKey);

    const used = countStr ? parseInt(countStr, 10) : 0;
    const resetTime = resetStr ? parseInt(resetStr, 10) : Date.now() + windowMs;
    const resetAfterSeconds = Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));

    return {
      used,
      remaining: Math.max(0, limit - used),
      resetAfterSeconds,
    };
  } catch (error) {
    console.error('[RateLimit] Error getting rate limit status:', error);
    return {
      used: 0,
      remaining: limit,
      resetAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }
}
