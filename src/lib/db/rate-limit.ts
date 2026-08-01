import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export type RateLimitVerdict = { allowed: boolean; retryAfterMs: number; remaining: number };

/**
 * Fixed-window rate limiting, stored in Postgres rather than in memory so the limit still
 * holds when the app runs more than one instance — and so restarting the app doesn't hand
 * an attacker a fresh budget.
 *
 * The whole read-modify-write is one `INSERT … ON CONFLICT DO UPDATE`. An interactive
 * transaction would be the obvious shape, but two simultaneous login attempts on the same
 * key then deadlock against each other: under a serialisable transaction the loser aborts,
 * and a rate limiter that throws during a burst is worse than no rate limiter. A single
 * statement takes one row lock and every caller gets a correct answer.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitVerdict> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + windowMs);

  const rows = await prisma.$queryRaw<{ count: number; expires_at: Date }[]>(Prisma.sql`
    INSERT INTO rate_limits (id, key, count, window_start, expires_at)
    VALUES (${randomUUID()}, ${key}, 1, ${now}, ${windowEnd})
    ON CONFLICT (key) DO UPDATE SET
      count        = CASE WHEN rate_limits.expires_at <= ${now} THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.expires_at <= ${now} THEN ${now} ELSE rate_limits.window_start END,
      expires_at   = CASE WHEN rate_limits.expires_at <= ${now} THEN ${windowEnd} ELSE rate_limits.expires_at END
    RETURNING count, expires_at
  `);

  const row = rows[0];
  // Only possible if the statement returned nothing, which it cannot; fail closed anyway.
  if (!row) return { allowed: false, retryAfterMs: windowMs, remaining: 0 };

  const used = Number(row.count);
  if (used > limit) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, row.expires_at.getTime() - now.getTime()),
      remaining: 0,
    };
  }
  return { allowed: true, retryAfterMs: 0, remaining: limit - used };
}

/** Clears a bucket — called after a successful login so one bad day doesn't lock a user out. */
export async function resetRateLimit(key: string): Promise<void> {
  await prisma.rateLimit.deleteMany({ where: { key } });
}

export async function pruneExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
