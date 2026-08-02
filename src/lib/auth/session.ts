import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import {
  createSession,
  deleteSession,
  findSession,
  makeTenantContext,
  touchSession,
} from '@/lib/db/unscoped';
import type { TenantSession } from '@/lib/tenant/context';
import { resolveTenant } from '@/lib/tenant/resolve';
import {
  cookieOptions,
  packCookie,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  unpackCookie,
} from './cookie';

/**
 * The session is always read *through the tenant resolved from the request host*. A cookie
 * stolen from one client's domain is inert on another's, even though both are served by
 * the same deployment.
 */
export const getSession = cache(async (): Promise<TenantSession | null> => {
  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return null;

  const store = await cookies();
  const token = unpackCookie(store.get(SESSION_COOKIE)?.value);
  if (!token) return null;

  const record = await findSession(hashToken(token), tenantLookup.tenant.id);
  if (!record) return null;

  // Rolling expiry, written at most once a day.
  const remaining = record.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
    await touchSession(record.sessionId, new Date(Date.now() + SESSION_TTL_MS));
  }

  return {
    tenant: tenantLookup.tenant,
    user: {
      id: record.userId,
      email: record.email,
      locale: record.locale,
      displayCurrency: record.displayCurrency,
      theme: record.theme,
      lastLoginAt: record.lastLoginAt,
    },
    ctx: makeTenantContext(record.tenantId, record.userId),
  };
});

/** For pages behind the login wall. Redirects rather than throwing. */
export async function requireSession(): Promise<TenantSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function startSession(userId: string): Promise<void> {
  const token = generateToken();
  const headerStore = await headers();

  await createSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    // Behind Caddy the client address is in X-Forwarded-For; take the first hop.
    ip: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerStore.get('user-agent')?.slice(0, 300) ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, packCookie(token), cookieOptions(SESSION_COOKIE_MAX_AGE_MS / 1000));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = unpackCookie(store.get(SESSION_COOKIE)?.value);
  if (token) await deleteSession(hashToken(token));
  store.set(SESSION_COOKIE, '', cookieOptions(0));
}
