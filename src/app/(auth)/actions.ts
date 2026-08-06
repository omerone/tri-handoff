'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { burnPasswordVerification } from '@/lib/auth/anti-timing';
import { clientIp, limitKey, LIMITS } from '@/lib/auth/limits';
import { startSession } from '@/lib/auth/session';
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  validatePasswordStrength,
} from '@/lib/crypto/password';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import { consumeRateLimit, resetRateLimit, touchLastLogin } from '@/lib/db';
import {
  createResetToken,
  findUserByEmailForReset,
  findUserForLogin,
  findValidResetToken,
  makeTenantContext,
  redeemResetToken,
} from '@/lib/db/unscoped';
import { sendPasswordResetEmail } from '@/lib/mail/password-reset';
import { setLocaleCookie, setThemeCookie } from '@/lib/preferences/cookies';
import { SecurityLogger } from '@/lib/security/logger';
import { resolveTenant } from '@/lib/tenant/resolve';

export type FormState = { error?: string; notice?: string };

const RESET_TTL_MINUTES = 30;

/**
 * The subject of an event about someone who is not a user here.
 *
 * `auth_events.user_id` is required and carries no foreign key, so a sign-in attempt against
 * an address that does not exist still has somewhere to go — and it has to, or the one thing
 * the trail cannot show is someone working through a list of addresses. It is keyed to the
 * tenant rather than to the address that was tried: the address is the attacker's input, it
 * may well be a real person's, and for a product with one user per tenant, filing it would
 * turn the trail into a record of who was guessed at. The count is the signal; the guess is
 * not evidence of anything.
 */
const unknownSubject = (tenantId: string) => `unknown:${tenantId}`;

/**
 * Minimum wall-clock time for a password-reset request, whatever happens inside it.
 *
 * The reply text is already identical for every outcome, but the *latency* was not: an
 * unknown address returned as soon as the lookup missed, while a known one additionally
 * wrote a token and waited on an SMTP round trip. That gap is tens to hundreds of
 * milliseconds — a far louder oracle than the password-verify gap `anti-timing.ts` exists to
 * close. The floor plus a non-awaited send makes both paths look the same from outside.
 */
const RESET_RESPONSE_FLOOR_MS = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const emailField = z.string().trim().toLowerCase().email();

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('auth');
  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return { error: t('invalidCredentials') };

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  // A malformed submission gets the same message as a wrong password: the form must not
  // reveal whether an address is even shaped like a known account.
  if (!parsed.success) return { error: t('invalidCredentials') };
  const { email, password } = parsed.data;

  const tenant = tenantLookup.tenant;
  const ip = await clientIp();

  const perAccount = await consumeRateLimit(
    limitKey('login', tenant.id, email),
    LIMITS.loginPerAccount.limit,
    LIMITS.loginPerAccount.windowMs,
  );
  const perIp = await consumeRateLimit(
    limitKey('login-ip', tenant.id, ip),
    LIMITS.loginPerIp.limit,
    LIMITS.loginPerIp.windowMs,
  );
  if (!perAccount.allowed || !perIp.allowed) {
    const waitMs = Math.max(perAccount.retryAfterMs, perIp.retryAfterMs);
    // Recorded against the tenant, because refusing without looking anyone up is the point of
    // getting here — a lookup to name the subject would spend the query the limit just saved.
    await SecurityLogger.logAuthEvent({
      userId: unknownSubject(tenant.id),
      eventType: 'login_blocked',
      description: 'Sign-in refused by the rate limiter',
      result: 'blocked',
      failureReason: 'rate_limited',
    });
    return { error: t('tooManyAttempts', { minutes: Math.max(1, Math.ceil(waitMs / 60_000)) }) };
  }

  const user = await findUserForLogin(tenant.id, email);
  if (!user) {
    await burnPasswordVerification(password);
    await SecurityLogger.logAuthEvent({
      userId: unknownSubject(tenant.id),
      eventType: 'login_failed',
      description: 'Sign-in attempted against an address with no account here',
      result: 'failure',
      failureReason: 'unknown_account',
    });
    return { error: t('invalidCredentials') };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    // The one event the alerting actually reads: `checkFailedLoginThreshold` counts these per
    // user, so a real account being ground at is what raises the alarm rather than volume.
    await SecurityLogger.logAuthEvent({
      userId: user.id,
      eventType: 'login_failed',
      description: 'Sign-in failed on the password',
      result: 'failure',
      failureReason: 'wrong_password',
    });
    return { error: t('invalidCredentials') };
  }

  await resetRateLimit(limitKey('login', tenant.id, email));
  await startSession(user.id);
  await SecurityLogger.logAuthEvent({
    userId: user.id,
    eventType: 'login_success',
    description: 'Signed in',
  });
  await touchLastLogin(makeTenantContext(user.tenantId, user.id));

  // Bring the cookie copies back in line with the account being signed in to. Without this a
  // fresh browser paints the default theme and language until something happens to write them.
  await setThemeCookie(user.theme);
  await setLocaleCookie(user.locale);

  // Outside the guarded section: redirect() signals by throwing.
  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// Request a reset link
// ---------------------------------------------------------------------------

const requestResetSchema = z.object({ email: emailField });

export async function requestResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const startedAt = Date.now();
  const t = await getTranslations('auth');

  // One reply for every path — sent, not sent, unknown address, rate-limited — and one
  // response time to go with it. Anything else turns this form into an account-existence
  // check, which for a one-user-per-tenant product means "is this trader a client".
  const uniformReply = async (): Promise<FormState> => {
    const elapsed = Date.now() - startedAt;
    if (elapsed < RESET_RESPONSE_FLOOR_MS) await sleep(RESET_RESPONSE_FLOOR_MS - elapsed);
    return { notice: t('resetSent') };
  };

  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return uniformReply();

  const parsed = requestResetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return uniformReply();
  const email = parsed.data.email;
  const tenant = tenantLookup.tenant;
  const ip = await clientIp();

  const perAccount = await consumeRateLimit(
    limitKey('reset', tenant.id, email),
    LIMITS.resetPerAccount.limit,
    LIMITS.resetPerAccount.windowMs,
  );
  const perIp = await consumeRateLimit(
    limitKey('reset-ip', tenant.id, ip),
    LIMITS.resetPerIp.limit,
    LIMITS.resetPerIp.windowMs,
  );
  if (!perAccount.allowed || !perIp.allowed) return uniformReply();

  const user = await findUserByEmailForReset(tenant.id, email);
  if (!user) return uniformReply();

  // Nothing is logged on this path, deliberately. Every branch above returns the same words
  // after the same 400ms precisely so the form cannot be used to ask whether an address is a
  // client here, and a write that only happens once the lookup hits is that question answered
  // in the database instead of on the screen. The reset that gets *completed* is logged, and
  // that one is an event about a user who exists.

  const token = generateToken();
  await createResetToken({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
  });

  // Not awaited: an SMTP round trip is the single largest thing that distinguishes a known
  // address from an unknown one. `sendMail` already swallows its own failures, and the user
  // is told the same thing either way, so there is nothing here to wait for.
  void sendPasswordResetEmail({
    to: user.email,
    locale: user.locale,
    domain: tenant.domain,
    token,
    ttlMinutes: RESET_TTL_MINUTES,
  }).catch((error) => {
    console.error('[reset] failed to send:', error instanceof Error ? error.message : error);
  });

  return uniformReply();
}

// ---------------------------------------------------------------------------
// Complete a reset
// ---------------------------------------------------------------------------

const completeResetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(MIN_PASSWORD_LENGTH),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'] });

export async function completeResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations('auth');
  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return { error: t('resetLinkInvalid') };

  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: t('passwordTooShort', { min: MIN_PASSWORD_LENGTH }) };
  }
  if (password !== confirm) return { error: t('passwordsDontMatch') };

  const parsed = completeResetSchema.safeParse({ token, password, confirm });
  if (!parsed.success) return { error: t('resetLinkInvalid') };

  const record = await findValidResetToken(hashToken(token), tenantLookup.tenant.id);
  if (!record) return { error: t('resetLinkInvalid') };

  // Strength is checked here rather than beside the length check above, because it needs the
  // account's own email to score against — and that is only known once the token resolves.
  try {
    validatePasswordStrength(password, [record.email]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password is not strong enough';
    return { error: message };
  }

  // Claims the token, sets the password and revokes every session atomically — see
  // redeemResetToken. Returns false if someone else redeemed the same link first.
  const redeemed = await redeemResetToken({
    tokenId: record.id,
    userId: record.userId,
    passwordHash: await hashPassword(password),
  });
  if (!redeemed) return { error: t('resetLinkInvalid') };

  // Every session was revoked in the same transaction, so this is also the record of everyone
  // who was signed out and why.
  await SecurityLogger.logAuthEvent({
    userId: record.userId,
    eventType: 'password_changed',
    description: 'Password set through a reset link; all sessions revoked',
  });

  redirect('/login?reset=done');
}
