import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clientIpForRecord } from './limits';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import { registerAuditIdentity } from './audit-identity';
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
      autoSyncOnLogin: record.autoSyncOnLogin,
      lastLoginAt: record.lastLoginAt,
    },
    ctx: makeTenantContext(record.tenantId, record.userId),
  };
});

/*
 * Hand the audit trail its "who".
 *
 * At module scope, so it is in place before the first query of any request that reaches this
 * file — and only in the Node bundle, which is the point: the trail cannot import sessions
 * itself without pulling `node:crypto` into the Edge build. `getSession` is request-cached,
 * so this costs the audit hook nothing beyond the lookup the page already made.
 */
registerAuditIdentity(async () => {
  const session = await getSession();
  return session ? { userId: session.ctx.userId, tenantId: session.ctx.tenantId } : null;
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
    // The socket peer as the proxy saw it, never the first hop of X-Forwarded-For: that list
    // is one a caller may prepend to, and this address is what an investigation would trust.
    ip: await clientIpForRecord(),
    userAgent: headerStore.get('user-agent')?.slice(0, 300) ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, packCookie(token), cookieOptions(SESSION_COOKIE_MAX_AGE_MS / 1000));
}

/**
 * The hash of the token this browser is holding, for the one caller that needs to keep its
 * own session while ending the rest.
 *
 * The hash, never the token: the pre-image is the credential, and nothing outside this file
 * has a reason to hold it. Returns null when there is no cookie, which reads as "keep
 * nothing" and is the safe way for that to fail.
 */
export async function currentSessionTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = unpackCookie(store.get(SESSION_COOKIE)?.value);
  return token ? hashToken(token) : null;
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = unpackCookie(store.get(SESSION_COOKIE)?.value);
  if (token) await deleteSession(hashToken(token));
  store.set(SESSION_COOKIE, '', cookieOptions(0));
}
