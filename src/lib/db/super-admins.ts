import 'server-only';
import { ADMIN_ABSOLUTE_TTL_MS } from '@/lib/auth/session-limits';
import { prisma } from './prisma';

/**
 * Super-admin identities — the operator of the platform, not a tenant user. Deliberately
 * kept in its own table with its own session table so that nothing about a client login can
 * ever grant operator access.
 */

export async function findSuperAdminByEmail(email: string) {
  return prisma.superAdmin.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, passwordHash: true },
  });
}

export async function upsertSuperAdmin(email: string, passwordHash: string): Promise<string> {
  const row = await prisma.superAdmin.upsert({
    where: { email: email.trim().toLowerCase() },
    update: { passwordHash },
    create: { email: email.trim().toLowerCase(), passwordHash },
    select: { id: true },
  });
  return row.id;
}

export async function createAdminSession(params: {
  superAdminId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.superAdminSession.create({ data: params });
}

/**
 * Two clocks, as on a client session: `expires_at` is the idle window and rolls, `created_at`
 * is the ceiling and does not. Both belong in the WHERE clause so there is no way to read an
 * operator session without applying them.
 */
export async function findAdminSession(tokenHash: string) {
  const now = Date.now();
  const row = await prisma.superAdminSession.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date(now) },
      createdAt: { gt: new Date(now - ADMIN_ABSOLUTE_TTL_MS) },
    },
    select: { id: true, expiresAt: true, superAdmin: { select: { id: true, email: true } } },
  });
  return row
    ? {
        sessionId: row.id,
        adminId: row.superAdmin.id,
        email: row.superAdmin.email,
        expiresAt: row.expiresAt,
      }
    : null;
}

/** Rolls the idle window of an operator session that is being used. */
export async function touchAdminSession(sessionId: string, expiresAt: Date): Promise<void> {
  await prisma.superAdminSession.update({ where: { id: sessionId }, data: { expiresAt } });
}

export async function deleteAdminSession(tokenHash: string): Promise<void> {
  await prisma.superAdminSession.deleteMany({ where: { tokenHash } });
}
