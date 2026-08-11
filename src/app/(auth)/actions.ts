'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { burnPasswordVerification } from '@/lib/auth/anti-timing';
import { clientIp, limitKey, LIMITS } from '@/lib/auth/limits';
import { startSession } from '@/lib/auth/session';
import { refreshRatesOnLogin } from '@/lib/money/refresh';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  validatePasswordStrength,
} from '@/lib/crypto/password';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import { consumeRateLimit, resetRateLimit, touchLastLogin } from '@/lib/db';
import {
  createResetToken,
  findUserByEmailForReset,
  findUserById,
  findUserForLogin,
  findValidResetToken,
  makeTenantContext,
  redeemResetToken,
} from '@/lib/db/unscoped';
import {
  answerChallenge,
  clearTwoFactorChallenge,
  pendingChallenge,
  startTwoFactorChallenge,
  twoFactorIsOn,
} from '@/lib/auth/two-factor';
import type { Locale } from '@/i18n/config';
import type { Theme } from '@/lib/theme';
import { sendPasswordResetEmail } from '@/lib/mail/password-reset';
import { setDisplayStyleCookie, setLocaleCookie, setThemeCookie } from '@/lib/preferences/cookies';
import type { DisplayStyle } from '@/lib/display-style';
import { SecurityLogger } from '@/lib/security/logger';
import { resolveTenant } from '@/lib/tenant/resolve';

/**
 * `step` is what the sign-in form renders.
 *
 * Absent, or `password`, is the form as it has always been. `totp` means the password was
 * right and the browser is now holding a challenge — see `startTwoFactorChallenge`. There is
 * deliberately no user id, email or name in this state: it crosses to the client, and the
 * only thing the client needs to know is which field to draw.
 */
export type FormState = { error?: string; notice?: string; step?: 'password' | 'totp' };

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
  // Bounded here too, though nothing downstream is slowed by a long one: argon2 digests the
  // password to a fixed size before the memory-hard work, so verifying a megabyte costs the
  // same 17ms as verifying twelve characters. This refuses to carry a megabyte through the
  // request for a value that cannot match a password no form would have accepted.
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
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

  /*
   * The password was right, which is not the same as being signed in.
   *
   * With 2FA on, this returns *without* calling `startSession` — the browser gets a challenge
   * token and nothing else, so every check that reads a session still says "nobody". The
   * theme and locale cookies wait as well: writing them here would tell an attacker holding
   * only the password which language the real owner reads in.
   */
  if (await twoFactorIsOn(user.id)) {
    await startTwoFactorChallenge(user.id);
    await SecurityLogger.logAuthEvent({
      userId: user.id,
      eventType: 'login_challenged',
      description: 'Password accepted; awaiting the second factor',
    });
    return { step: 'totp' };
  }

  // `return`, not a bare call: `completeSignIn` ends in `redirect`, which signals by throwing,
  // and returning its `Promise<never>` is how the type checker is told nothing follows.
  return completeSignIn(user);
}

/**
 * Everything that happens once identity is settled, whether that took one factor or two.
 *
 * Extracted so the two paths cannot drift: a session, the audit line, the login stamp and the
 * two preference cookies belong together, and the failure mode of forgetting one of them on
 * the 2FA path is silent — a trader who turns on 2FA and then finds their theme resets on
 * every sign-in, or worse, a sign-in that never reaches the audit trail.
 *
 * Ends in `redirect`, which signals by throwing, so it never returns.
 */
async function completeSignIn(user: {
  id: string;
  tenantId: string;
  locale: Locale;
  theme: Theme;
  displayStyle: DisplayStyle;
}): Promise<never> {
  await startSession(user.id);
  await SecurityLogger.logAuthEvent({
    userId: user.id,
    eventType: 'login_success',
    description: 'Signed in',
  });
  const ctx = makeTenantContext(user.tenantId, user.id);
  await touchLastLogin(ctx);

  /*
   * Freshen the exchange rates for the account being signed in to.
   *
   * `after` rather than `await`: this is two or three HTTP calls to a rate feed, and nobody
   * should watch a login spinner for them. It runs once the response has gone out, so the
   * redirect below is not delayed by a slow — or unreachable — third party. The dashboard the
   * user lands on reads whatever is cached at that instant, which is the previous rate on the
   * first page and the new one from there on; the alternative is holding the sign-in open for
   * a figure that is accurate to a fraction of a percent either way.
   *
   * Wrapped, because a rate feed being down is not a failed sign-in.
   */
  after(async () => {
    try {
      await refreshRatesOnLogin(ctx);
    } catch (error) {
      console.warn('[fx] login refresh failed:', error instanceof Error ? error.message : error);
    }
  });

  // Bring the cookie copies back in line with the account being signed in to. Without this a
  // fresh browser paints the default theme, language and look until something writes them —
  // and for the style that "something" was only the settings screen, so the login page could
  // disagree with the product indefinitely.
  await setThemeCookie(user.theme);
  await setLocaleCookie(user.locale);
  await setDisplayStyleCookie(user.displayStyle);

  // Outside the guarded section: redirect() signals by throwing.
  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// The second factor
// ---------------------------------------------------------------------------

/**
 * The code step.
 *
 * Reached only with a live challenge in the browser, which is only issued after a password
 * verified. Everything that could go wrong — no challenge, an expired one, a wrong code, one
 * too many wrong codes — returns the person to the password form, because in every one of
 * those cases that is genuinely where they are: the challenge is gone and the way forward is
 * to prove the first factor again.
 */
export async function verifyTwoFactorAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations('auth');
  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return { error: t('invalidCredentials') };

  const tenant = tenantLookup.tenant;
  const ip = await clientIp();

  /*
   * Bounds the password-then-guess loop, which the challenge's own counter cannot see: each
   * pass through it is a fresh row starting from zero attempts. Consumed before the challenge
   * is looked up, so a caller with no challenge at all still pays for the attempt.
   */
  const perIp = await consumeRateLimit(
    limitKey('2fa-ip', tenant.id, ip),
    LIMITS.twoFactorPerIp.limit,
    LIMITS.twoFactorPerIp.windowMs,
  );
  if (!perIp.allowed) {
    await clearTwoFactorChallenge();
    return {
      step: 'password',
      error: t('tooManyAttempts', {
        minutes: Math.max(1, Math.ceil(perIp.retryAfterMs / 60_000)),
      }),
    };
  }

  const challenge = await pendingChallenge(tenant.id);
  if (!challenge) {
    await clearTwoFactorChallenge();
    return { step: 'password', error: t('twoFactorExpired') };
  }

  const outcome = await answerChallenge(challenge, String(formData.get('code') ?? ''));

  if (outcome.status === 'exhausted') {
    await SecurityLogger.logAuthEvent({
      userId: challenge.userId,
      eventType: 'login_failed',
      description: 'Second factor failed too many times; challenge destroyed',
      result: 'blocked',
      failureReason: 'two_factor_exhausted',
    });
    return { step: 'password', error: t('twoFactorExhausted') };
  }

  if (outcome.status !== 'passed') {
    await SecurityLogger.logAuthEvent({
      userId: challenge.userId,
      eventType: 'login_failed',
      description: 'Second factor rejected',
      result: 'failure',
      failureReason: 'two_factor_wrong',
    });
    return {
      step: 'totp',
      error: outcome.status === 'expired' ? t('twoFactorExpired') : t('twoFactorWrong'),
    };
  }

  // The challenge names the user; re-reading the row is what supplies the theme and locale
  // that `completeSignIn` needs, and confirms the account still exists.
  const user = await findUserById(outcome.userId);
  if (!user) return { step: 'password', error: t('invalidCredentials') };

  return completeSignIn(user);
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
    password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
    confirm: z.string().max(MAX_PASSWORD_LENGTH),
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
