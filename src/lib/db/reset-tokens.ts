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

/**
 * Redeems a reset token: marks it used, sets the new password and revokes every session the
 * user has, all in one transaction.
 *
 * The three steps were separate awaits once, which had two problems. Two simultaneous posts
 * of the same link both passed the "is this token still valid" check before either wrote
 * `usedAt`, so both set a password — "single use" only held when nobody raced it. And a
 * crash between the password write and the consume left a used link still live. Marking the
 * token first, conditionally on it still being unused, makes the claim atomic: whoever wins
 * `updateMany` gets `count === 1`, everyone else gets 0 and changes nothing.
 *
 * Returns false if the token was already redeemed.
 */
export async function redeemResetToken(params: {
  tokenId: string;
  userId: string;
  passwordHash: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: params.tokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return false;

    await tx.user.update({
      where: { id: params.userId },
      data: { passwordHash: params.passwordHash },
    });
    // Changing the password is the point at which every other session must die.
    await tx.session.deleteMany({ where: { userId: params.userId } });
    return true;
  });
}
