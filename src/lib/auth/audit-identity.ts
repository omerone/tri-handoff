/**
 * Who the current request belongs to, published by the auth layer for the audit trail.
 *
 * The obvious shape — the audit hook calling `getSession()` — cannot be built. `session.ts`
 * reaches `node:crypto` to hash the cookie, the audit hook lives under the Prisma client, and
 * the Prisma client is reachable from `instrumentation.ts`, which Next also compiles for the
 * Edge runtime. Importing the session there, however lazily, drags `node:crypto` into a
 * bundle that has no such module and the build stops.
 *
 * So the dependency runs the other way: `session.ts` registers a resolver when it loads,
 * which happens on any request that has a session and never in the Edge bundle. This module
 * imports nothing at all, so it is safe everywhere.
 */

export type AuditIdentity = { userId: string; tenantId: string };

let resolve: (() => Promise<AuditIdentity | null>) | null = null;

/** Called once, at module scope, by whatever owns sessions. */
export function registerAuditIdentity(resolver: () => Promise<AuditIdentity | null>): void {
  resolve = resolver;
}

/**
 * The signed-in user, or null.
 *
 * Null is the normal answer for a background job — the maintenance sweep, the quote refresh,
 * a CLI script — and for the Edge runtime, where no resolver was ever registered.
 */
export async function currentAuditIdentity(): Promise<AuditIdentity | null> {
  if (!resolve) return null;
  try {
    return await resolve();
  } catch {
    // No request context. A trail entry with no user is the correct record of a timer.
    return null;
  }
}
