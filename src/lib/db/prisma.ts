import 'server-only';
import { PrismaClient } from '@prisma/client';
import { setupAuditMiddleware } from '@/lib/db/audit-middleware';

/**
 * The raw Prisma client. **Do not import this outside src/lib/db** — ESLint enforces it.
 * Unscoped access is how one tenant ends up reading another tenant's trades; the
 * repositories in this directory exist so that every query carries a tenant scope.
 *
 * Audit middleware is automatically initialized to log all database operations.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

// Initialize audit middleware to log all database operations
if (!globalForPrisma.prisma) {
  setupAuditMiddleware();
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
