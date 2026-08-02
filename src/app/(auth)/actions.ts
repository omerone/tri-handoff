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
import { resolveTenant } from '@/lib/tenant/resolve';

export type FormState = { error?: string; notice?: string };

const RESET_TTL_MINUTES = 30;

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
    return { error: t('tooManyAttempts', { minutes: Math.max(1, Math.ceil(waitMs / 60_000)) }) };
  }

  const user = await findUserForLogin(tenant.id, email);
  if (!user) {
    await burnPasswordVerification(password);
    return { error: t('invalidCredentials') };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    return { error: t('invalidCredentials') };
  }

  await resetRateLimit(limitKey('login', tenant.id, email));
  await startSession(user.id);
  await touchLastLogin(makeTenantContext(user.tenantId, user.id));

  // Outside the guarded section: redirect() signals by throwing.
  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// Request a reset link
// ---------------------------------------------------------------------------

const requestResetSchema = z.object({ email: emailField });

export async function requestResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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

  // Validate password strength using zxcvbn (score >= 3 required)
  try {
    validatePasswordStrength(password, [record.email]);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Password is not strong enough';
    return { error: message };
  }

  const parsed = completeResetSchema.safeParse({ token, password, confirm });
  if (!parsed.success) return { error: t('resetLinkInvalid') };

  const record = await findValidResetToken(hashToken(token), tenantLookup.tenant.id);
  if (!record) return { error: t('resetLinkInvalid') };

  // Claims the token, sets the password and revokes every session atomically — see
  // redeemResetToken. Returns false if someone else redeemed the same link first.
  const redeemed = await redeemResetToken({
    tokenId: record.id,
    userId: record.userId,
    passwordHash: await hashPassword(password),
  });
  if (!redeemed) return { error: t('resetLinkInvalid') };

  redirect('/login?reset=done');
}
