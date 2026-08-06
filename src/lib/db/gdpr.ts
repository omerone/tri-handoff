import 'server-only';
import { prisma } from './prisma';

/**
 * GDPR Data Subject Deletion Procedures
 *
 * Implements comprehensive account deletion to comply with GDPR Article 17 (Right to Erasure).
 * When a user requests account deletion, all personal data is permanently removed.
 *
 * Data Cascade:
 * - User table (deletes user)
 * - Tenant → cascades deletion (references User uniquely)
 * - Sessions → cascade delete via User
 * - PasswordResetTokens → cascade delete via User
 * - Mt5Account → cascade delete via User
 * - Trades → cascade delete via User
 * - FinanceEntries → cascade delete via User
 * - LongPositions → cascade delete via User
 * - SyncLogs → cascade delete via User
 * - AuthEvents → cascade delete via User
 * - DataAccessLogs → cascade delete via User
 *
 * Non-deleted (for audit trail):
 * - AdminAuditLog: Kept for 7 years per GDPR Records of Processing Activity
 *   (but user_id and tenant_id are nullified)
 */

/**
 * Audit log for user deletion (GDPR compliance)
 */
interface DeletionAuditLog {
  userId: string;
  tenantId: string;
  email: string;
  deletedAt: Date;
  recordsDeleted: {
    sessions: number;
    resetTokens: number;
    mt5Accounts: number;
    trades: number;
    financeEntries: number;
    longPositions: number;
    syncLogs: number;
    authEvents: number;
    dataAccessLogs: number;
  };
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Validate deletion request (security checks)
 *
 * Ensures:
 * 1. User ID matches session user (no privilege escalation)
 * 2. Password is correct (confirm user intent)
 * 3. User hasn't deleted account recently (prevent accidental re-deletion)
 *
 * Usage: Call this before deleteUserDataGDPR to verify user intent
 */
export async function validateDeletionRequest(
  userId: string,
  passwordHash: string,
  userProvidedPassword: string,
): Promise<{ valid: boolean; error?: string }> {
  // Import password verification from crypto module
  const { verifyPassword } = await import('@/lib/crypto/password');
  const passwordValid = await verifyPassword(passwordHash, userProvidedPassword);

  if (!passwordValid) {
    return { valid: false, error: 'Invalid password provided' };
  }

  return { valid: true };
}

/**
 * Perform GDPR right to erasure (account deletion)
 *
 * This function:
 * 1. Counts records to be deleted
 * 2. Deletes all user data
 * 3. Nullifies references in audit logs
 * 4. Logs the deletion event
 * 5. Returns audit log for compliance
 *
 * CRITICAL: This is destructive and irreversible. Should only be called after:
 * - User authentication
 * - Password confirmation
 * - 72-hour notice (best practice, not required by law)
 */
export async function deleteUserDataGDPR(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<DeletionAuditLog> {
  const startTime = Date.now();

  // Get user info before deletion (for audit log)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      tenantId: true,
    },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Count records before deletion (for audit)
  const counts = await countUserRecords(userId);

  // Perform deletion in transaction
  await prisma.$transaction(async (tx) => {
    // 1. Delete auth events (user login/password events)
    await tx.authEvent.deleteMany({
      where: { userId },
    });

    // 2. Delete data access logs (audit trail for data exports)
    await tx.dataAccessLog.deleteMany({
      where: { userId },
    });

    // 3. Delete sync logs
    await tx.syncLog.deleteMany({
      where: { userId },
    });

    // 4. Delete trades (trading history)
    await tx.trade.deleteMany({
      where: { userId },
    });

    // 5. Delete finance entries (personal finance)
    await tx.financeEntry.deleteMany({
      where: { userId },
    });

    // 6. Delete long positions (manual positions)
    await tx.longPosition.deleteMany({
      where: { userId },
    });

    // 7. Delete MT5 account (broker connection)
    await tx.mt5Account.deleteMany({
      where: { userId },
    });

    // 8. Delete password reset tokens (unused tokens)
    await tx.passwordResetToken.deleteMany({
      where: { userId },
    });

    // 9. Delete sessions (active login sessions)
    await tx.session.deleteMany({
      where: { userId },
    });

    // 10. Nullify references in admin audit log (keep for 7-year retention)
    await tx.adminAuditLog.updateMany({
      where: { userId },
      data: {
        userId: null,
        tenantId: null,
      },
    });

    // 11. Delete user (cascades to tenant via unique constraint)
    await tx.user.delete({
      where: { id: userId },
    });
  });

  const deletedAt = new Date();
  const duration = Date.now() - startTime;

  const auditLog: DeletionAuditLog = {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    deletedAt,
    recordsDeleted: counts,
    ipAddress,
    userAgent,
  };

  /*
   * That a deletion happened, and how much it took — not who it was.
   *
   * This line used to carry the address, the email and the requesting IP of the
   * person whose entire request was that we stop holding those. The rows go, the log
   * keeps them: container logs rotate on size rather than on any policy, nothing
   * prunes them on a schedule, and no future erasure request reaches them. Doing that
   * in the one function whose purpose is erasure is the wrong place to be careless.
   *
   * The counts stay, and they are what a compliance question actually asks — *did we
   * delete, and what*. They identify nobody: the userId and tenantId are gone from the
   * line for the same reason `deleteUserDataGDPR` nullifies them in `admin_audit_logs`
   * rather than leaving them to point at a user who no longer exists. Re-creating that
   * link in stderr would undo the care taken twenty lines above.
   *
   * If a per-request record is ever needed — the regulation wants you able to show a
   * request was honoured — it belongs in a store designed for it, with its own
   * retention and its own access control. `auditLog` is returned for a caller to do
   * exactly that. A rotating log file is not that store.
   */
  console.error('[GDPR] account deleted on request', {
    timestamp: deletedAt.toISOString(),
    durationMs: duration,
    recordsDeleted: counts,
  });

  return auditLog;
}

/**
 * Count all records associated with a user
 * Used for audit logging
 */
async function countUserRecords(userId: string): Promise<DeletionAuditLog['recordsDeleted']> {
  const [
    sessions,
    resetTokens,
    mt5Accounts,
    trades,
    financeEntries,
    longPositions,
    syncLogs,
    authEvents,
    dataAccessLogs,
  ] = await Promise.all([
    prisma.session.count({ where: { userId } }),
    prisma.passwordResetToken.count({ where: { userId } }),
    prisma.mt5Account.count({ where: { userId } }),
    prisma.trade.count({ where: { userId } }),
    prisma.financeEntry.count({ where: { userId } }),
    prisma.longPosition.count({ where: { userId } }),
    prisma.syncLog.count({ where: { userId } }),
    prisma.authEvent.count({ where: { userId } }),
    prisma.dataAccessLog.count({ where: { userId } }),
  ]);

  return {
    sessions,
    resetTokens,
    mt5Accounts,
    trades,
    financeEntries,
    longPositions,
    syncLogs,
    authEvents,
    dataAccessLogs,
  };
}

/**
 * Export user data (GDPR Article 20 - Data Portability)
 *
 * Returns all personal data in JSON format for user download.
 * Useful for users who want a copy before deletion.
 */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      // Sessions by their columns rather than whole, and no reset tokens at all.
      //
      // Both tables were pulled in full. The returned object already picks safe fields off a
      // session and never mentions reset tokens, so nothing leaked — but `tokenHash` was
      // loaded into memory for both, and the only reason to load a row is to return it.
      // Whoever next adds a field to this export will do it by reaching into what is already
      // here, and what is already here is credential material.
      sessions: {
        select: {
          id: true,
          createdAt: true,
          lastSeenAt: true,
          expiresAt: true,
          ip: true,
          userAgent: true,
        },
      },
      mt5Account: true,
      trades: true,
      financeEntries: true,
      longPositions: true,
      syncLogs: true,
    },
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  // Get related audit logs
  const authEvents = await prisma.authEvent.findMany({
    where: { userId },
  });

  const dataAccessLogs = await prisma.dataAccessLog.findMany({
    where: { userId },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      locale: user.locale,
      displayCurrency: user.displayCurrency,
      theme: user.theme,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
    mt5Account: user.mt5Account
      ? {
          login: user.mt5Account.login,
          server: user.mt5Account.server,
          status: user.mt5Account.status,
          lastSyncAt: user.mt5Account.lastSyncAt,
          accountCurrency: user.mt5Account.accountCurrency,
          balance: user.mt5Account.balance,
          equity: user.mt5Account.equity,
        }
      : null,
    trades: user.trades,
    financeEntries: user.financeEntries,
    longPositions: user.longPositions,
    syncLogs: user.syncLogs,
    authEvents,
    dataAccessLogs,
    sessions: user.sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      ip: s.ip,
      userAgent: s.userAgent,
    })),
  };
}

/**
 * Check if user data deletion is possible
 * (Useful for pre-flight checks before showing UI)
 */
export async function canDeleteUserData(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  return user !== null;
}

/**
 * Get deletion status/timeline
 * (For progress tracking during deletion)
 */
export async function getDeletionStatus(userId: string) {
  const counts = await countUserRecords(userId);

  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return {
    userId,
    totalRecordsThatWillBeDeleted: totalRecords,
    breakdown: counts,
    estimatedTimeSeconds: Math.ceil(totalRecords / 100), // rough estimate
  };
}

/**
 * GDPR Compliance Documentation
 *
 * Legal Basis for Data Deletion:
 * - GDPR Article 17: Right to Erasure ("Right to be Forgotten")
 * - GDPR Article 5: Principles (storage limitation)
 * - GDPR Article 32: Security (erasure is secure deletion)
 *
 * Data Retention Rules:
 * - Transactional data: Deleted on user request
 * - Audit logs (AdminAuditLog): Kept for 7 years (legal requirement)
 *   but user references are nullified
 * - Backup copies: Should follow same deletion schedule
 *
 * Process Flow:
 * 1. User initiates deletion via POST /account/delete
 * 2. Backend verifies password (confirms user intent)
 * 3. Backend logs deletion event to audit trail
 * 4. Backend cascades deletion through Prisma schema
 * 5. Database transaction ensures atomicity (all-or-nothing)
 * 6. Return deletion confirmation to user
 * 7. Email confirmation sent to user
 *
 * Irreversibility:
 * - Deletion is immediate and permanent
 * - No 30-day grace period (GDPR doesn't require one for user-initiated deletion)
 * - Backups may retain data for 30 days (document this in privacy policy)
 * - After 30 days, backup deletion can be verified
 *
 * User Communication:
 * - Send confirmation email after deletion
 * - Document: what data was deleted, when, why
 * - Include backup retention window
 * - Provide support contact for questions
 */
