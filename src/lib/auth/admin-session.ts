import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import {
  createAdminSession,
  deleteAdminSession,
  findAdminSession,
  touchAdminSession,
} from '@/lib/db/unscoped';
import { env } from '@/lib/env';
import { normalizeDomain } from '@/lib/tenant/domain';
import { getRequestHost } from '@/lib/tenant/resolve';
import { ADMIN_SESSION_COOKIE, cookieOptions, packCookie, unpackCookie } from './cookie';
import {
  ADMIN_ABSOLUTE_TTL_MS,
  ADMIN_IDLE_TTL_MS,
  SESSION_REFRESH_AFTER_MS,
} from './session-limits';

export type AdminIdentity = { adminId: string; email: string };

/**
 * The admin panel is served **only on the platform's own base domain**, never on a client's.
 * A customer visiting their own TRi should not even be able to see that an operator login
 * exists there, let alone reach it.
 */
export async function assertAdminHost(): Promise<void> {
  const expected = normalizeDomain(env().APP_BASE_DOMAIN);
  const actual = await getRequestHost();
  if (!expected || actual !== expected) notFound();
}

export const getAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const store = await cookies();
  const token = unpackCookie(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (!token) return null;

  const record = await findAdminSession(hashToken(token));
  if (!record) return null;

  // Half an hour of inactivity ends it, and the eight-hour ceiling in `findAdminSession` ends
  // it regardless. Rolling here is what turns the ceiling into a ceiling rather than the only
  // clock there was: before this, a panel signed into at nine was open at five untouched.
  const remaining = record.expiresAt.getTime() - Date.now();
  if (remaining < ADMIN_IDLE_TTL_MS - SESSION_REFRESH_AFTER_MS) {
    await touchAdminSession(record.sessionId, new Date(Date.now() + ADMIN_IDLE_TTL_MS));
  }

  return { adminId: record.adminId, email: record.email };
});

export async function requireAdmin(): Promise<AdminIdentity> {
  await assertAdminHost();
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}

/**
 * The same gate for a route handler, which cannot answer with a redirect.
 *
 * Returns the operator, or the response to send instead. Two failures, told apart on purpose:
 * a request to the wrong host gets a 404 — the operator API does not exist on a client's
 * domain, and saying "unauthorized" would confirm that it exists somewhere — while a request
 * to the right host without a session gets a 401.
 */
export async function adminForApi(): Promise<
  { admin: AdminIdentity; response?: never } | { admin?: never; response: Response }
> {
  const expected = normalizeDomain(env().APP_BASE_DOMAIN);
  const actual = await getRequestHost();
  if (!expected || actual !== expected) {
    return { response: new Response('not found', { status: 404 }) };
  }

  const admin = await getAdmin();
  if (!admin) {
    return {
      response: Response.json(
        { error: 'Unauthorized: operator session required' },
        { status: 401 },
      ),
    };
  }
  return { admin };
}

export async function startAdminSession(superAdminId: string): Promise<void> {
  const token = generateToken();
  await createAdminSession({
    superAdminId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ADMIN_IDLE_TTL_MS),
  });

  const store = await cookies();
  // The cookie is given the ceiling, not the idle window: it is transport, and the row is what
  // decides. A cookie that dies at half past would sign out an operator who is working.
  store.set(ADMIN_SESSION_COOKIE, packCookie(token), cookieOptions(ADMIN_ABSOLUTE_TTL_MS / 1000));
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  const token = unpackCookie(store.get(ADMIN_SESSION_COOKIE)?.value);
  if (token) await deleteAdminSession(hashToken(token));
  store.set(ADMIN_SESSION_COOKIE, '', cookieOptions(0));
}
