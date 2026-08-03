import 'server-only';
import { PrismaClient } from '@prisma/client';
import { auditExtension } from '@/lib/db/audit-middleware';

/**
 * The raw Prisma client. **Do not import this outside src/lib/db** — ESLint enforces it.
 * Unscoped access is how one tenant ends up reading another tenant's trades; the
 * repositories in this directory exist so that every query carries a tenant scope.
 *
 * Every mutation is written to the audit trail by `auditExtension`. It is applied here, at
 * the one place the client is constructed, because an extension *returns a new client* rather
 * than modifying the one it is handed — a `setupAudit()` called for its side effect audits
 * nothing at all, which is the worst way for an audit trail to fail.
 */

const createClient = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  }).$extends(auditExtension);

/** Extending changes the client's type, so it is inferred rather than spelled out. */
type ExtendedPrismaClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
