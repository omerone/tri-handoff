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

const createBase = () =>
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

type BasePrismaClient = ReturnType<typeof createBase>;
/** Extending changes the client's type, so it is inferred rather than spelled out. */
type ExtendedPrismaClient = ReturnType<typeof createBase> extends infer T
  ? T extends BasePrismaClient
    ? ReturnType<typeof extend>
    : never
  : never;

const extend = (client: BasePrismaClient) => client.$extends(auditExtension);

const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
  prismaBase?: BasePrismaClient;
};

const base: BasePrismaClient = globalForPrisma.prismaBase ?? createBase();

/**
 * The unextended client, for the audit writer and nothing else.
 *
 * Writing the trail through the extended client means the write is itself audited, and the
 * only thing standing between that and unbounded recursion is a string comparison on the
 * model name. One connection, two views of it: the audit row goes in through a client that
 * has no extension to re-enter.
 */
export const prismaBase: BasePrismaClient = base;

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? extend(base);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaBase = base;
  globalForPrisma.prisma = prisma;
}
