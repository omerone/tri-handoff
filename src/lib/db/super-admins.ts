import 'server-only';
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

export async function findAdminSession(tokenHash: string) {
  const row = await prisma.superAdminSession.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() } },
    select: { id: true, superAdmin: { select: { id: true, email: true } } },
  });
  return row ? { sessionId: row.id, adminId: row.superAdmin.id, email: row.superAdmin.email } : null;
}

export async function deleteAdminSession(tokenHash: string): Promise<void> {
  await prisma.superAdminSession.deleteMany({ where: { tokenHash } });
}
