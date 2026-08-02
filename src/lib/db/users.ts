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
    select: {
      id: true,
      email: true,
      locale: true,
      displayCurrency: true,
      theme: true,
      lastLoginAt: true,
    },
  });
  return row
    ? {
        id: row.id,
        email: row.email,
        locale: row.locale,
        displayCurrency: row.displayCurrency,
        theme: row.theme,
        lastLoginAt: row.lastLoginAt,
      }
    : null;
}

export async function updateUserPreferences(
  ctx: TenantContext,
  data: { locale?: Locale; displayCurrency?: string; theme?: 'dark' | 'light' | 'system' },
): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data,
  });
}

/**
 * Sets a password and ends every session the user has, in one transaction.
 *
 * The revocation is inside this function rather than left to callers on purpose. The
 * self-service reset already did it (`redeemResetToken`); the operator path called this and
 * did not — so an operator resetting a password for the very reason the feature exists
 * ("I can't receive my reset email", which is also what a compromised account looks like)
 * believed they had locked an attacker out while the attacker's session rolled on. A caller
 * cannot forget something it does not have to remember.
 */
export async function setPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

export async function touchLastLogin(ctx: TenantContext): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data: { lastLoginAt: new Date() },
  });
}
