'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { limitKey, LIMITS } from '@/lib/auth/limits';
import { generateRecoveryCodes } from '@/lib/auth/recovery-codes';
import { requireSession } from '@/lib/auth/session';
import { openSecret, sealSecret } from '@/lib/auth/two-factor';
import {
  formatSecretForEntry,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from '@/lib/auth/totp';
import { verifyPassword } from '@/lib/crypto/password';
import { consumeRateLimit } from '@/lib/db';
import { findPasswordHash } from '@/lib/db/security-events';
import {
  beginTwoFactorSetup,
  confirmTwoFactor,
  disableTwoFactor,
  getTwoFactorState,
  replaceRecoveryCodes,
} from '@/lib/db/two-factor';
import { SecurityLogger } from '@/lib/security/logger';

/**
 * Turning the second factor on and off, from inside a session.
 *
 * Three things are true of every action here and are the reason they are written the way they
 * are:
 *
 *   1. **The session is not enough.** Enabling 2FA on someone else's stolen session would lock
 *      the real owner out; disabling it would remove the protection the theft was supposed to
 *      run into. Both directions ask for the password, and both are budgeted, because a
 *      password prompt with no budget is a guessing oracle.
 *   2. **Secrets and codes cross the wire once.** The secret is returned only while it is
 *      unconfirmed, the recovery codes only in the response that generates them. Neither is
 *      ever readable again from a page render.
 *   3. **Nothing half-finished counts.** A secret with no `confirmedAt` is an abandoned
 *      wizard, and every read path treats it as "2FA is off".
 */

export type TwoFactorState = {
  error?: string;
  notice?: string;
  /** The QR payload and the typed-out key. Present only during setup. */
  setup?: { uri: string; manualKey: string };
  /** Shown exactly once, when they are generated. */
  recoveryCodes?: string[];
};

async function budget(userId: string): Promise<string | null> {
  const verdict = await consumeRateLimit(
    limitKey('2fa-manage', userId),
    LIMITS.twoFactorManage.limit,
    LIMITS.twoFactorManage.windowMs,
  );
  if (verdict.allowed) return null;
  const t = await getTranslations('auth');
  return t('tooManyAttempts', { minutes: Math.max(1, Math.ceil(verdict.retryAfterMs / 60_000)) });
}

/** Re-authenticates the person already sitting in the session. */
async function passwordHolds(userId: string, submitted: string): Promise<boolean> {
  const hash = await findPasswordHash(userId);
  if (!hash) return false;
  return verifyPassword(hash, submitted);
}

/**
 * Step one: mint a secret and hand back what a phone needs to store it.
 *
 * The secret is written to the database immediately, unconfirmed. It has to be — the code the
 * trader is about to type is generated from it, so it must survive the round trip — and
 * writing it unconfirmed is precisely what makes an abandoned setup harmless.
 */
export async function beginTwoFactorAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const session = await requireSession();
  const t = await getTranslations('settings.twoFactor');

  const limited = await budget(session.ctx.userId);
  if (limited) return { error: limited };

  if (!(await passwordHolds(session.user.id, String(formData.get('password') ?? '')))) {
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'two_factor_setup_failed',
      description: 'Wrong password at the start of two-factor setup',
      result: 'failure',
      failureReason: 'wrong_password',
    });
    return { error: t('wrongPassword') };
  }

  const secret = generateTotpSecret();
  await beginTwoFactorSetup(session.ctx.userId, sealSecret(secret));

  return {
    setup: {
      uri: otpauthUri({ secret, account: session.user.email, issuer: 'TRi' }),
      manualKey: formatSecretForEntry(secret),
    },
  };
}

/**
 * Step two: the first correct code turns it on, and the recovery codes come back with it.
 *
 * The step that matched is recorded in the same statement, so the very code used to switch 2FA
 * on cannot also be used to sign in with — the replay guard starts closed rather than opening
 * a window on the way in.
 */
export async function confirmTwoFactorAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const session = await requireSession();
  const t = await getTranslations('settings.twoFactor');

  const limited = await budget(session.ctx.userId);
  if (limited) return { error: limited };

  const state = await getTwoFactorState(session.ctx.userId);
  if (!state?.secret) return { error: t('setupLost') };
  if (state.confirmedAt) return { error: t('alreadyOn') };

  const verdict = verifyTotp(openSecret(state.secret), String(formData.get('code') ?? ''), {
    atMs: Date.now(),
    lastStep: state.lastStep,
  });
  if (!verdict.ok) {
    /*
      The setup survives a wrong code. The alternative — discarding the secret — would mean a
      phone whose clock is a minute out has to re-scan a new QR on every attempt, and the
      thing being protected against here is guessing, which the budget above already covers.
      Re-issuing the payload so the page can keep showing the same QR.
    */
    const secret = openSecret(state.secret);
    return {
      error: t('wrongCode'),
      setup: {
        uri: otpauthUri({ secret, account: session.user.email, issuer: 'TRi' }),
        manualKey: formatSecretForEntry(secret),
      },
    };
  }

  const codes = generateRecoveryCodes();
  await confirmTwoFactor(session.ctx.userId, {
    at: new Date(),
    step: verdict.step,
    recoveryHashes: codes.hashes,
  });

  await SecurityLogger.logAuthEvent({
    userId: session.user.id,
    eventType: 'two_factor_enabled',
    description: 'Two-factor authentication turned on',
  });

  revalidatePath('/settings');
  return { notice: t('enabled'), recoveryCodes: codes.plain };
}

/**
 * Issues a fresh set and invalidates every previous one.
 *
 * For the trader who has used most of theirs, or printed them somewhere they no longer trust.
 * The old set stops working the moment this returns, which is the whole point and is said on
 * screen before the button is pressed.
 */
export async function regenerateRecoveryCodesAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const session = await requireSession();
  const t = await getTranslations('settings.twoFactor');

  const limited = await budget(session.ctx.userId);
  if (limited) return { error: limited };

  const state = await getTwoFactorState(session.ctx.userId);
  if (!state?.confirmedAt) return { error: t('notOn') };

  if (!(await passwordHolds(session.user.id, String(formData.get('password') ?? '')))) {
    return { error: t('wrongPassword') };
  }

  const codes = generateRecoveryCodes();
  await replaceRecoveryCodes(session.ctx.userId, codes.hashes);

  await SecurityLogger.logAuthEvent({
    userId: session.user.id,
    eventType: 'two_factor_codes_regenerated',
    description: 'Recovery codes replaced; the previous set no longer works',
  });

  revalidatePath('/settings');
  return { notice: t('codesReplaced'), recoveryCodes: codes.plain };
}

export async function disableTwoFactorAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const session = await requireSession();
  const t = await getTranslations('settings.twoFactor');

  const limited = await budget(session.ctx.userId);
  if (limited) return { error: limited };

  if (!(await passwordHolds(session.user.id, String(formData.get('password') ?? '')))) {
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'two_factor_disable_failed',
      description: 'Wrong password while trying to turn two-factor off',
      result: 'failure',
      failureReason: 'wrong_password',
    });
    return { error: t('wrongPassword') };
  }

  await disableTwoFactor(session.ctx.userId);
  await SecurityLogger.logAuthEvent({
    userId: session.user.id,
    eventType: 'two_factor_disabled',
    description: 'Two-factor authentication turned off',
  });

  revalidatePath('/settings');
  return { notice: t('disabled') };
}
