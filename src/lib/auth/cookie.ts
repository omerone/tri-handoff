import 'server-only';
import { createHmac } from 'node:crypto';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto/secretbox';

/**
 * Session cookie format: `<token>.<hmac>`.
 *
 * The token alone would be enough — it is 256 random bits and only its hash is stored. The
 * HMAC (keyed by SESSION_SECRET) lets us reject a forged or corrupted cookie without a
 * database round-trip, so a flood of junk cookies costs a hash instead of a query.
 */

export const SESSION_COOKIE = 'tri_session';
export const ADMIN_SESSION_COOKIE = 'tri_admin_session';

/**
 * Carries the second-factor challenge between the password step and the code step.
 *
 * A separate cookie rather than an early session, because it must not be mistakable for one:
 * `getSession` reads `SESSION_COOKIE` and nothing else, so a browser holding only this one is
 * signed in nowhere. It is packed and unpacked with the same HMAC as the session cookie, and
 * like it, the value is an opaque token whose hash is the only copy stored.
 */
export const TWO_FACTOR_COOKIE = 'tri_2fa';

/**
 * How long someone has to fetch their phone and type six digits.
 *
 * Five minutes. Long enough to find the app, unlock the phone and read a code that may be
 * about to roll over; short enough that a challenge left open on a shared machine is not a
 * standing invitation. Expiring costs the password again, which is a small price and the
 * only safe direction to err in.
 */
export const TWO_FACTOR_TTL_MS = 5 * 60 * 1000;

/**
 * Session lifetime lives in the database, not in the cookie.
 *
 * `SESSION_TTL_MS` is the authority: 30 days of inactivity ends the session, and every use
 * pushes it out again. The cookie cannot carry that, because a rolling expiry would mean
 * re-issuing it on every page render — and cookies can only be written from a server action
 * or route handler, never from the layout that reads the session. So the cookie is given the
 * longest max-age browsers honour and acts purely as transport; `findSession` filters on
 * `expiresAt`, so a cookie that outlives its row authenticates nothing.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Chrome caps cookie lifetime at 400 days and silently clamps anything longer. */
export const SESSION_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
/** Rewrite the expiry at most once a day, to avoid a write on every request. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

function sign(token: string): string {
  return createHmac('sha256', Buffer.from(env().SESSION_SECRET, 'base64'))
    .update(token)
    .digest('base64url');
}

export function packCookie(token: string): string {
  return `${token}.${sign(token)}`;
}

/** Returns the token if the signature checks out, otherwise null. */
export function unpackCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  return safeEqual(signature, sign(token)) ? token : null;
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env().APP_PROTOCOL === 'https',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
