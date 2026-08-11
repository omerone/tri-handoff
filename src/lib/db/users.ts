import 'server-only';
import type { DisplayStyle, Theme } from '@prisma/client';
import { cache } from 'react';
import { Prisma } from '@prisma/client';
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
    // `locale`, `theme` and `displayStyle` ride along so sign-in can refresh their cookie
    // copies: a browser that has never seen this account carries no cookies, and the first
    // paint after login would otherwise be the defaults rather than the user's. The style was
    // missing from this list, and the miss was visible: an account set to the amber
    // "instrument" look signed in through a blue "depth" login screen on every device,
    // forever, because nothing ever taught the browser otherwise.
    select: {
      id: true,
      tenantId: true,
      email: true,
      passwordHash: true,
      locale: true,
      theme: true,
      displayStyle: true,
    },
  });
}

/**
 * The same fields as `findUserForLogin`, minus the password hash, keyed by id.
 *
 * For the second-factor step, which already knows *which* user it is about — the challenge
 * row named them — and needs the preference columns to finish the sign-in. Unscoped by tenant
 * because the challenge lookup that produced this id was already joined to one; asking again
 * here would be checking the same boundary twice and implying the id came from somewhere less
 * trusted than it did.
 */
export async function findUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, tenantId: true, email: true, locale: true, theme: true, displayStyle: true },
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
      displayStyle: true,
      autoSyncOnLogin: true,
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
        displayStyle: row.displayStyle,
        autoSyncOnLogin: row.autoSyncOnLogin,
        lastLoginAt: row.lastLoginAt,
      }
    : null;
}

export async function updateUserPreferences(
  ctx: TenantContext,
  data: {
    locale?: Locale;
    displayCurrency?: string;
    theme?: 'dark' | 'light' | 'system';
    displayStyle?: 'depth' | 'instrument' | 'calm';
    autoSyncOnLogin?: boolean;
  },
): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data,
  });
}

/**
 * The dashboard arrangement (SPEC §1.1).
 *
 * It is read on its own rather than through `getUser` so it stays out of the session
 * payload: it is a list that only one page needs, and it would otherwise be carried on
 * every request the app serves.
 *
 * The value is returned raw. Interpreting it is `normalizeLayout`'s job, which the caller
 * runs — that keeps the tolerance for stale shapes in one place, tested without a database.
 */
/** Per-request only — see the note in db/mt5-accounts.ts. */
export const getDashboardLayout = cache(
  async (ctx: TenantContext): Promise<unknown> => {
    assertContext(ctx);
    const row = await prisma.user.findFirst({
      where: { id: ctx.userId, tenantId: ctx.tenantId },
      select: { dashboardLayout: true },
    });
    return row?.dashboardLayout ?? null;
  },
);

/** Saves an arrangement, or clears it (`null`) to fall back to the default. */
export async function saveDashboardLayout(
  ctx: TenantContext,
  layout: readonly { id: string; span: number }[] | null,
): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    // Prisma reads `null` on a Json column as "SQL NULL or JSON null?", so it wants the
    // intent spelled out. Clearing the column is what restores the default.
    data: { dashboardLayout: layout === null ? Prisma.DbNull : [...layout] },
  });
}

/**
 * The signed-in user's own password.
 *
 * Deliberately separate from `setPasswordHash` below, which takes a bare user id and will
 * overwrite anybody's password — that one belongs to `./unscoped`, is restricted to the
 * modules that establish identity, and is what the operator console uses. A trader changing
 * their own password from Settings is a tenant-scoped act, so it takes a context and the
 * `where` names both the user and the tenant: there is no id a form could submit that would
 * reach another account.
 */
export async function setOwnPasswordHash(
  ctx: TenantContext,
  passwordHash: string,
): Promise<void> {
  assertContext(ctx);
  await prisma.user.updateMany({
    where: { id: ctx.userId, tenantId: ctx.tenantId },
    data: { passwordHash },
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

/**
 * How the domain's one trader likes the product to look, for painting screens that render
 * before anyone is signed in.
 *
 * Legitimate precisely because of the product's shape: a tenant has exactly one user, so
 * "the login page's style" has a well-defined answer here in a way it would not in any
 * multi-user product. Appearance only — no id, no email — because the caller is unauthenticated
 * by definition, and this function's select is the whole of what it can learn.
 */
export async function tenantAppearance(
  tenantId: string,
): Promise<{ theme: Theme; displayStyle: DisplayStyle } | null> {
  const row = await prisma.user.findUnique({
    where: { tenantId },
    select: { theme: true, displayStyle: true },
  });
  return row;
}
