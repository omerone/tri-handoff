import 'server-only';
import type { Locale } from '@/i18n/config';
import type { TenantContext, TenantUser } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * Login lookup. Scoped by tenant id, so the same email address on two client domains is
 * two unrelated accounts and a password from one is meaningless on the other.
 */
export async function findUserForLogin(tenantId: string, email: string) {
  return prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } },
    select: { id: true, tenantId: true, email: true, passwordHash: true },
  });
}

export async function findUserByEmailForReset(tenantId: string, email: string) {
  return prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: email.trim().toLowerCase() } },
    select: { id: true, tenantId: true, email: true, locale: true },
  });
}

export async function getUser(ctx: TenantContext): Promise<TenantUser | null> {
  assertContext(ctx);
  const row = await prisma.user.findFirst({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    select: { id: true, email: true, locale: true, displayCurrency: true, lastLoginAt: true },
  });
  return row
    ? {
        id: row.id,
        email: row.email,
        locale: row.locale,
        displayCurrency: row.displayCurrency,
        lastLoginAt: row.lastLoginAt,
      }
    : null;
}

export async function updateUserPreferences(
  ctx: TenantContext,
  data: { locale?: Locale; displayCurrency?: string },
): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data,
  });
}

export async function setPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function touchLastLogin(ctx: TenantContext): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data: { lastLoginAt: new Date() },
  });
}
