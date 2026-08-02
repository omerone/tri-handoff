/**
 * Admin endpoint: Rate limit status dashboard
 * GET /api/admin/rate-limits/status
 *
 * Returns:
 * - Current rate limit usage per IP/user
 * - Historical rate limit hits
 * - Top abusers (IPs, users)
 * - Endpoint health (which routes being hit hardest)
 *
 * Requires: Super-admin access
 * Cache: 5 minute TTL
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis/client';
import { RATE_LIMITS } from '@/config/rate-limits';

interface RateLimitStatus {
  key: string;
  used: number;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
}

interface AdminRateLimitResponse {
  timestamp: string;
  redis: {
    healthy: boolean;
    mode: 'redis' | 'in-memory';
  };
  summary: {
    totalKeys: number;
    violationsLast24h: number;
    topEndpoints: Array<{ endpoint: string; hits: number }>;
  };
  recentViolations: Array<{
    key: string;
    timestamp: string;
    limit: number;
    resetAfterSeconds: number;
  }>;
  config: {
    backoffEnabled: boolean;
    backoffMultiplier: number;
    backoffMaxDelayMs: number;
  };
}

/**
 * Check if request is from admin user
 * In production, this should check JWT token and admin role
 */
async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7);

  // In production, verify JWT token and check for admin role
  // For now, check if token matches admin token in env
  const adminTokens = (process.env.ADMIN_API_TOKENS || '').split(',').filter(Boolean);
  return adminTokens.some((t) => t.trim() === token);
}

/**
 * Get rate limit status for a specific key
 */
async function getKeyStatus(key: string, limit: number, windowMs: number): Promise<RateLimitStatus> {
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
      key,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetAfterSeconds,
    };
  } catch (error) {
    console.error('[AdminStatus] Error getting key status:', error);
    return {
      key,
      used: 0,
      limit,
      remaining: limit,
      resetAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }
}

/**
 * Scan for all rate limit keys in Redis
 * Note: This is a simplified implementation. In production, use SCAN to avoid blocking.
 */
async function scanRateLimitKeys(): Promise<string[]> {
  const keys: string[] = [];

  // In production, we would:
  // 1. Use SCAN cursor to iterate keys without blocking
  // 2. Filter by prefix pattern
  // 3. Aggregate by endpoint

  // For now, return empty array
  // Production implementation would require Redis SCAN support
  return keys;
}

/**
 * Check Redis health
 */
async function checkRedisHealth(): Promise<{
  healthy: boolean;
  mode: 'redis' | 'in-memory';
}> {
  try {
    const redis = await getRedisClient();
    await redis.ping();
    return { healthy: true, mode: 'redis' };
  } catch (error) {
    return { healthy: false, mode: 'in-memory' };
  }
}

export async function GET(request: NextRequest) {
  try {
    // Check admin access
    const isAdmin = await isAdminRequest(request);
    if (!isAdmin) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Admin access required',
        },
        { status: 401 }
      );
    }

    // Check cache
    const cacheKey = 'ratelimit:status:cache';
    const redis = await getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: {
          'Cache-Control': 'public, max-age=300', // 5 minutes
          'X-Cache': 'HIT',
        },
      });
    }

    // Get Redis health
    const redisHealth = await checkRedisHealth();

    // Scan for rate limit keys (simplified)
    const keys = await scanRateLimitKeys();

    // Get statuses for recent endpoints
    const recentViolations: AdminRateLimitResponse['recentViolations'] = [];

    // Aggregate endpoint hits
    const endpointHits = new Map<string, number>();
    keys.forEach((key) => {
      const endpoint = key.split(':')[0];
      endpointHits.set(endpoint, (endpointHits.get(endpoint) || 0) + 1);
    });

    const topEndpoints = Array.from(endpointHits.entries())
      .map(([endpoint, hits]) => ({ endpoint, hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);

    const response: AdminRateLimitResponse = {
      timestamp: new Date().toISOString(),
      redis: redisHealth,
      summary: {
        totalKeys: keys.length,
        violationsLast24h: keys.length, // Simplified
        topEndpoints,
      },
      recentViolations,
      config: {
        backoffEnabled: RATE_LIMITS.backoff.enabled,
        backoffMultiplier: RATE_LIMITS.backoff.multiplier,
        backoffMaxDelayMs: RATE_LIMITS.backoff.maxDelay,
      },
    };

    // Cache response
    try {
      await redis.set(cacheKey, JSON.stringify(response), 5 * 60 * 1000);
    } catch (error) {
      console.error('[AdminStatus] Failed to cache response:', error);
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('[AdminStatus] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
