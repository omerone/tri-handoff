'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { deleteUserDataGDPR, validateDeletionRequest } from '@/lib/db/gdpr';
import { SecurityLogger } from '@/lib/security/logger';
// eslint-disable-next-line no-restricted-imports
import { prisma } from '@/lib/db/prisma';

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
  formData: FormData
): Promise<AccountFormState> {
  const session = await requireSession();
  const t = await getTranslations('settings.account');

  try {
    // Parse and validate form input
    const parsed = deleteAccountSchema.parse({
      password: formData.get('password'),
    });

    // Fetch user to get password hash (not included in session for security)
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });

    if (!user) {
      return { error: t('deleteFailedUserNotFound') };
    }

    // Verify password matches
    const validationResult = await validateDeletionRequest(
      session.user.id,
      user.passwordHash,
      parsed.password
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
    const ipAddress = headersList.get('x-forwarded-for') || null;
    const userAgent = headersList.get('user-agent') || null;

    // Perform deletion (cascades through database)
    const auditLog = await deleteUserDataGDPR(session.user.id, ipAddress || undefined, userAgent || undefined);

    // Log successful deletion
    console.error('[GDPR] Account deletion completed', {
      userId: auditLog.userId,
      email: auditLog.email,
      timestamp: auditLog.deletedAt.toISOString(),
      recordsDeleted: auditLog.recordsDeleted,
    });

    // Clear the cache (user data is gone)
    revalidatePath('/', 'layout');

    // Redirect to login page (user will not be logged in anymore)
    redirect('/auth/login?deleted=true');
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
}
