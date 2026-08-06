import 'server-only';
import type { Locale } from '@/i18n/config';
import { prisma } from './prisma';

/**
 * Session storage. The cookie carries a random token; only its SHA-256 lives here, so the
 * table is useless to anyone who reads it.
 */

export type SessionRecord = {
  sessionId: string;
  userId: string;
  tenantId: string;
  email: string;
  locale: Locale;
  displayCurrency: string;
  theme: 'dark' | 'light' | 'system';
  lastLoginAt: Date | null;
  tenantName: string;
  tenantDomain: string;
  tenantStatus: 'active' | 'suspended';
  expiresAt: Date;
};

export async function createSession(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.session.create({
    data: {
      userId: params.userId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

/**
 * Looks up a session and returns it together with its tenant, in one query.
 *
 * The caller passes the tenant resolved from the request host; a session issued on one
 * client's domain must not authenticate a request arriving on another's, so the tenant id
 * is part of the WHERE clause rather than something checked afterwards.
 */
export async function findSession(
  tokenHash: string,
  tenantId: string,
): Promise<SessionRecord | null> {
  const row = await prisma.session.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      user: { tenantId },
    },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          tenantId: true,
          email: true,
          locale: true,
          displayCurrency: true,
          theme: true,
          lastLoginAt: true,
          tenant: { select: { name: true, domain: true, status: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    sessionId: row.id,
    userId: row.user.id,
    tenantId: row.user.tenantId,
    email: row.user.email,
    locale: row.user.locale,
    displayCurrency: row.user.displayCurrency,
    theme: row.user.theme,
    lastLoginAt: row.user.lastLoginAt,
    tenantName: row.user.tenant.name,
    tenantDomain: row.user.tenant.domain,
    tenantStatus: row.user.tenant.status,
    expiresAt: row.expiresAt,
  };
}

/** Rolling expiry: an active user is not logged out mid-session. */
export async function touchSession(sessionId: string, expiresAt: Date): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { expiresAt, lastSeenAt: new Date() },
  });
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash } });
}

/** Invalidate every session for a user — used after a password change. */
export async function deleteUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Every session for a user except the one asking.
 *
 * `deleteUserSessions` is right after a password reset, where nobody is signed in to keep.
 * Changing a factor from *inside* a session is the other case: the browser doing it should
 * stay, and every other one should go. Signing someone out of the tab they are looking at,
 * one second after they turned on the protection, reads as the feature having failed.
 */
export async function deleteOtherUserSessions(
  userId: string,
  keepTokenHash: string,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId, tokenHash: { not: keepTokenHash } },
  });
  return count;
}

export async function pruneExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
