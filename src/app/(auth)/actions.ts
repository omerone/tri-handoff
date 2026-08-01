'use server';

import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { burnPasswordVerification } from '@/lib/auth/anti-timing';
import { clientIp, limitKey, LIMITS } from '@/lib/auth/limits';
import { startSession } from '@/lib/auth/session';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '@/lib/crypto/password';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import {
  consumeRateLimit,
  consumeResetToken,
  createResetToken,
  deleteUserSessions,
  findUserByEmailForReset,
  findUserForLogin,
  findValidResetToken,
  resetRateLimit,
  setPasswordHash,
} from '@/lib/db';
import { sendPasswordResetEmail } from '@/lib/mail/password-reset';
import { resolveTenant } from '@/lib/tenant/resolve';

export type FormState = { error?: string; notice?: string };

const RESET_TTL_MINUTES = 30;

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
  const t = await getTranslations('auth');
  // One reply for every path — sent, not sent, unknown address, rate-limited. Anything
  // else turns this form into an account-existence check.
  const uniformReply: FormState = { notice: t('resetSent') };

  const tenantLookup = await resolveTenant();
  if (tenantLookup.state !== 'active') return uniformReply;

  const parsed = requestResetSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return uniformReply;
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
  if (!perAccount.allowed || !perIp.allowed) return uniformReply;

  const user = await findUserByEmailForReset(tenant.id, email);
  if (!user) return uniformReply;

  const token = generateToken();
  await createResetToken({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
  });

  await sendPasswordResetEmail({
    to: user.email,
    locale: user.locale,
    domain: tenant.domain,
    token,
    ttlMinutes: RESET_TTL_MINUTES,
  });

  return uniformReply;
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

  await setPasswordHash(record.userId, await hashPassword(password));
  await consumeResetToken(record.id);
  // A password change ends every existing session — that is the point of resetting it.
  await deleteUserSessions(record.userId);

  redirect('/login?reset=done');
}
