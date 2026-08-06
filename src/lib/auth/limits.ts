import 'server-only';
import { headers } from 'next/headers';

/**
 * Rate-limit budgets. Kept in one place so the security review has a single table to read.
 *
 * Login is limited twice: per account (stops someone grinding one trader's password) and
 * per client address (stops one host spraying many addresses).
 */
export const LIMITS = {
  loginPerAccount: { limit: 10, windowMs: 15 * 60 * 1000 },
  loginPerIp: { limit: 30, windowMs: 15 * 60 * 1000 },
  resetPerAccount: { limit: 5, windowMs: 60 * 60 * 1000 },
  resetPerIp: { limit: 15, windowMs: 60 * 60 * 1000 },
  syncManual: { limit: 6, windowMs: 5 * 60 * 1000 },
  /**
   * Deleting the account asks for the password again, which makes it a password prompt like
   * any other — and one behind a session that may already be stolen. Without a budget it is
   * an unlimited guessing oracle against the very credential that protects everything else.
   * Five an hour is far above any honest use: nobody deletes their account twice.
   */
  accountDelete: { limit: 5, windowMs: 60 * 60 * 1000 },
  /**
   * Operator login is tighter than a client's: there is no self-service reset behind it,
   * compromising it exposes every client, and legitimate use is a handful of sign-ins a
   * week. Per-account as well as per-IP, so rotating source addresses does not buy an
   * attacker an unlimited guess budget.
   */
  adminLoginPerAccount: { limit: 5, windowMs: 15 * 60 * 1000 },
  adminLoginPerIp: { limit: 10, windowMs: 15 * 60 * 1000 },
} as const;

/**
 * Client address, for per-IP buckets.
 *
 * `X-Real-Ip` first, and it is not a stylistic preference. Caddy sets it from `{remote_host}`
 * — the socket peer, which the caller cannot choose. `X-Forwarded-For` is a list a client is
 * free to prepend to, and a proxy that appends rather than overwrites will happily pass the
 * forged entry through; taking `split(',')[0]` off it hands an attacker a fresh rate-limit
 * bucket per request, which is the same as having no rate limit. The Caddyfile now
 * overwrites both headers, so the fallback is only reached in a direct-to-app dev run.
 */
export async function clientIp(): Promise<string> {
  const store = await headers();
  const real = store.get('x-real-ip')?.trim();
  if (real) return real;
  return store.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * The same address, for a column rather than a bucket.
 *
 * `clientIp` answers `'unknown'` when there is no address to be had, which is the right answer
 * for a rate limiter — every anonymous caller shares one bucket. It is the wrong thing to
 * write into an audit row, where it reads as an address someone actually came from. The
 * columns are nullable for exactly this case.
 */
export async function clientIpForRecord(): Promise<string | null> {
  const ip = await clientIp();
  return ip === 'unknown' ? null : ip;
}

export function limitKey(bucket: string, ...parts: string[]): string {
  return `${bucket}:${parts.join('|')}`;
}
