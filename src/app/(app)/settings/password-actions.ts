'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { limitKey, LIMITS } from '@/lib/auth/limits';
import { currentSessionTokenHash, requireSession } from '@/lib/auth/session';
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  analyzePasswordStrength,
  verifyPassword,
} from '@/lib/crypto/password';
import { consumeRateLimit, deleteOtherUserSessions, setOwnPasswordHash } from '@/lib/db';
import { findPasswordHash } from '@/lib/db/security-events';
import { SecurityLogger } from '@/lib/security/logger';

export type PasswordFormState = { error?: string; notice?: string };

/**
 * Letting the trader change their own password.
 *
 * Until this existed there was no way for them to: the sign-in screen offers "forgot
 * password", which mails a link, and nobody could set one from inside the app. So the only
 * route was the operator running `tenant:credentials` — which means the operator picks the
 * password, knows it, and stays the only person who can ever change it. That is the wrong
 * shape for a credential, and it does not survive a second client.
 *
 * The account is handed over with a password the operator chose; this is where it stops being
 * one the operator knows.
 */
export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const session = await requireSession();
  const t = await getTranslations('settings');
  const tAuth = await getTranslations('auth');

  /*
   * Throttled on the *current* password field, because that field is a password oracle: it is
   * the one place a signed-in session can guess the account's password without a sign-in
   * attempt, and without a limit here a stolen cookie could grind it offline-fast.
   */
  const verdict = await consumeRateLimit(
    limitKey('password-change', session.user.id),
    LIMITS.twoFactorManage.limit,
    LIMITS.twoFactorManage.windowMs,
  );
  if (!verdict.allowed) return { error: tAuth('tooManyAttempts', { minutes: 15 }) };

  const current = String(formData.get('currentPassword') ?? '');
  const next = String(formData.get('newPassword') ?? '');
  const confirm = String(formData.get('confirmPassword') ?? '');

  // Re-authenticate the person already sitting in the session. A live cookie proves somebody
  // opened this browser once; it does not prove they are the account holder now, and changing
  // the password is exactly the action that would lock the real one out.
  const hash = await findPasswordHash(session.user.id);
  if (!hash || !(await verifyPassword(hash, current))) {
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'password_change_failed',
      description: 'Wrong current password on a password change',
      result: 'failure',
      failureReason: 'wrong_password',
    });
    return { error: t('passwordWrong') };
  }

  if (next !== confirm) return { error: tAuth('passwordsDontMatch') };
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { error: tAuth('passwordTooShort', { min: MIN_PASSWORD_LENGTH }) };
  }
  if (next.length > MAX_PASSWORD_LENGTH) return { error: t('passwordTooLong') };

  /*
   * The same check the reset flow and the provisioning script apply, with the email passed in
   * as a user input so a password built out of the address it signs in with is refused. A
   * weak password chosen here would otherwise be weaker than the generated one it replaced,
   * which would make this feature a downgrade.
   */
  const strength = analyzePasswordStrength(next, [session.user.email]);
  if (!strength.isStrong) {
    return { error: strength.feedback.warning || t('passwordWeak') };
  }

  await setOwnPasswordHash(session.ctx, await hashPassword(next));

  /*
   * Every other session dies with the old password — the whole reason to change one is that
   * somebody may be holding the old credential, and a live session *is* the old credential.
   * Except this one: signing someone out of the tab they are looking at, one second after
   * they changed their password, reads as the change having failed.
   */
  const keep = await currentSessionTokenHash();
  const closed = keep ? await deleteOtherUserSessions(session.user.id, keep) : 0;

  await SecurityLogger.logAuthEvent({
    userId: session.user.id,
    eventType: 'password_changed',
    description: `Password changed from settings; ${closed} other session(s) ended`,
  });

  revalidatePath('/', 'layout');
  return { notice: t('passwordChanged') };
}
