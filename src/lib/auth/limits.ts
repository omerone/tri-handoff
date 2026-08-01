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
} as const;

/** Best-effort client address. Behind Caddy this is the first hop of X-Forwarded-For. */
export async function clientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return store.get('x-real-ip')?.trim() || 'unknown';
}

export function limitKey(bucket: string, ...parts: string[]): string {
  return `${bucket}:${parts.join('|')}`;
}
