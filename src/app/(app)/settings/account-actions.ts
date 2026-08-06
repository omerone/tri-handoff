'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { clientIpForRecord, limitKey, LIMITS } from '@/lib/auth/limits';
import { requireSession } from '@/lib/auth/session';
import { consumeRateLimit } from '@/lib/db';
import { deleteUserDataGDPR, validateDeletionRequest } from '@/lib/db/gdpr';
import { SecurityLogger } from '@/lib/security/logger';
import { findPasswordHash } from '@/lib/db/security-events';

export type AccountFormState = { error?: string; notice?: string };

const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

/**
 * Delete user account and all associated data (GDPR Article 17)
 *
 * Requires:
 * 1. User authentication (session)
 * 2. Password confirmation (prevents accidental deletion)
 *
 * Deletes:
 * - All user data (trades, finance, positions, MT5 account)
 * - All sessions
 * - All password reset tokens
 * - Auth events (user-scoped only)
 *
 * Keeps for audit (nullified user references):
 * - Admin audit logs (7-year legal retention)
 *
 * After deletion, user is logged out and redirected to /auth/login
 */
export async function deleteUserAccount(
  formState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await requireSession();
  const t = await getTranslations('settings.account');

  // The password prompt below is a password prompt, and an unbudgeted one is a guessing
  // oracle for anyone holding a stolen session. The same limiter the login uses, because a
  // second rate-limiting mechanism is a second thing to get wrong.
  const verdict = await consumeRateLimit(
    limitKey('account-delete', session.ctx.userId),
    LIMITS.accountDelete.limit,
    LIMITS.accountDelete.windowMs,
  );
  if (!verdict.allowed) {
    const tAuth = await getTranslations('auth');
    return {
      error: tAuth('tooManyAttempts', { minutes: Math.ceil(verdict.retryAfterMs / 60_000) }),
    };
  }

  try {
    // Parse and validate form input
    const parsed = deleteAccountSchema.parse({
      password: formData.get('password'),
    });

    // Fetch the password hash (deliberately not on the session) to re-authenticate.
    const passwordHash = await findPasswordHash(session.user.id);

    if (!passwordHash) {
      return { error: t('deleteFailedUserNotFound') };
    }

    // Verify password matches
    const validationResult = await validateDeletionRequest(
      session.user.id,
      passwordHash,
      parsed.password,
    );

    if (!validationResult.valid) {
      // Log failed deletion attempt
      await SecurityLogger.logAuthEvent({
        userId: session.user.id,
        eventType: 'account_deletion_failed',
        description: 'Account deletion attempt with invalid password',
        result: 'failure',
        failureReason: validationResult.error,
      });

      return {
        error: t('deleteFailedInvalidPassword'),
      };
    }

    // Log deletion attempt
    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'account_deletion_initiated',
      description: `Account deletion initiated by user ${session.user.email}`,
      result: 'success',
    });

    // Get client IP and user agent for audit log
    const headersList = await headers();
    const ipAddress = await clientIpForRecord();
    const userAgent = headersList.get('user-agent') || null;

    // Perform deletion (cascades through database)
    const auditLog = await deleteUserDataGDPR(
      session.user.id,
      ipAddress || undefined,
      userAgent || undefined,
    );

    // Log successful deletion
    console.error('[GDPR] Account deletion completed', {
      userId: auditLog.userId,
      email: auditLog.email,
      timestamp: auditLog.deletedAt.toISOString(),
      recordsDeleted: auditLog.recordsDeleted,
    });

    // Clear the cache (user data is gone)
    revalidatePath('/', 'layout');
  } catch (error) {
    // Log unexpected errors (but don't expose details)
    console.error('[GDPR] Account deletion error', error);

    await SecurityLogger.logAuthEvent({
      userId: session.user.id,
      eventType: 'account_deletion_failed',
      description: 'Account deletion failed due to internal error',
      result: 'failure',
      failureReason: 'system_error',
    });

    return {
      error: t('deleteFailedSystem'),
    };
  }

  // Outside the `try`, and deliberately. `redirect()` reports itself by throwing a
  // NEXT_REDIRECT error, so a `redirect` inside the block above was caught by the very
  // `catch` meant for database failures: the account was deleted, the user was told the
  // deletion had failed, and they were left sitting on the settings page with a dead session.
  //
  // `/login`, not `/auth/login` — `(auth)` is a route group and never appears in the URL,
  // so the old path was a 404 on the one navigation the user cannot retry.
  redirect('/login?deleted=true');
}
