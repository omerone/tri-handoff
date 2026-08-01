import 'server-only';
import type { TenantContext } from '@/lib/tenant/context';

/**
 * Constructs the branded scoping key. Internal to src/lib/db — nothing outside this
 * directory can produce a `TenantContext`, so no query can be issued without one.
 */
export function makeTenantContext(tenantId: string, userId: string): TenantContext {
  if (!tenantId || !userId) {
    throw new Error('makeTenantContext requires both a tenant id and a user id');
  }
  return { tenantId, userId } as TenantContext;
}

/**
 * Defence in depth: every repository calls this before touching Prisma, so a context that
 * was cast into existence somewhere still fails loudly instead of running an unscoped
 * query.
 */
export function assertContext(ctx: TenantContext): void {
  if (!ctx || typeof ctx.tenantId !== 'string' || typeof ctx.userId !== 'string') {
    throw new Error('A valid TenantContext is required for this query');
  }
  if (ctx.tenantId.length === 0 || ctx.userId.length === 0) {
    throw new Error('A valid TenantContext is required for this query');
  }
}
