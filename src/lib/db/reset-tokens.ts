import 'server-only';
import { prisma } from './prisma';

export async function createResetToken(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  // Only one live reset link per user: requesting a new one invalidates the old.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: params.userId, usedAt: null } }),
    prisma.passwordResetToken.create({ data: params }),
  ]);
}

export type ResetTokenRecord = { id: string; userId: string; tenantId: string };

/**
 * Resolves a reset token. Scoped by tenant for the same reason sessions are: a link issued
 * on one client's domain must not work on another's.
 */
export async function findValidResetToken(
  tokenHash: string,
  tenantId: string,
): Promise<ResetTokenRecord | null> {
  const row = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
      user: { tenantId },
    },
    select: { id: true, userId: true, user: { select: { tenantId: true } } },
  });
  return row ? { id: row.id, userId: row.userId, tenantId: row.user.tenantId } : null;
}

export async function consumeResetToken(id: string): Promise<void> {
  await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
}
