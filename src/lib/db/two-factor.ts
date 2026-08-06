import 'server-only';
import { prisma } from './prisma';

/**
 * Second-factor state, read and written without a `TenantContext`.
 *
 * Unscoped for the same reason password verification is: all of it runs at sign-in, before
 * there is a session to make a context from. Every function here therefore takes an explicit
 * `userId` that the caller must already have established — which, on the login path, means
 * "the password verified" and nothing weaker.
 *
 * The secret is stored encrypted and recovery codes arrive already hashed; this module never
 * sees either plaintext. Both transformations happen in `@/lib/auth`, so the key material
 * stays in one layer and the query layer keeps its single job.
 *
 * That separation is also load-bearing for the build, not only for the design. `@/lib/db` is
 * re-exported to `src/instrumentation-node.ts`, which Next compiles for the Edge runtime as
 * well — and `node:crypto` is a build error there. Importing `hashToken` here to save the
 * caller one line broke `next build` while the dev server carried on working, because
 * Turbopack resolves it and webpack does not. Nothing in this file may reach for a Node
 * built-in.
 */

export type TwoFactorState = {
  /** Encrypted. Null when 2FA was never started. */
  secret: string | null;
  /** Null means off, whatever `secret` holds — an abandoned setup leaves a secret behind. */
  confirmedAt: Date | null;
  lastStep: number | null;
  /** Hashes of the codes still unused. Its length is the count shown in settings. */
  recoveryCodes: string[];
};

const STATE_SELECT = {
  totpSecret: true,
  totpConfirmedAt: true,
  totpLastStep: true,
  totpRecoveryCodes: true,
} as const;

type StateRow = {
  totpSecret: string | null;
  totpConfirmedAt: Date | null;
  totpLastStep: number | null;
  totpRecoveryCodes: string[];
};

const toState = (row: StateRow): TwoFactorState => ({
  secret: row.totpSecret,
  confirmedAt: row.totpConfirmedAt,
  lastStep: row.totpLastStep,
  recoveryCodes: row.totpRecoveryCodes,
});

export async function getTwoFactorState(userId: string): Promise<TwoFactorState | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: STATE_SELECT });
  return row ? toState(row) : null;
}

/**
 * Stores a fresh, unconfirmed secret, discarding anything half-finished before it.
 *
 * Recovery codes are cleared here rather than when 2FA is confirmed: a secret that has been
 * replaced makes the codes issued against the old one meaningless, and leaving them in place
 * would keep a set of live bypass credentials for a factor that no longer exists.
 */
export async function beginTwoFactorSetup(userId: string, encryptedSecret: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: encryptedSecret,
      totpConfirmedAt: null,
      totpLastStep: null,
      totpRecoveryCodes: [],
    },
  });
}

/**
 * Turns 2FA on, in one statement with the codes it hands back and the step just spent.
 *
 * `confirmedAt` and `recoveryCodes` must land together: confirmed with no codes is an account
 * whose owner is locked out the day they lose their phone, and codes with no confirmation is a
 * set of credentials that open a door which is not yet closed.
 */
export async function confirmTwoFactor(
  userId: string,
  options: { at: Date; step: number; recoveryHashes: string[] },
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpConfirmedAt: options.at,
      totpLastStep: options.step,
      totpRecoveryCodes: options.recoveryHashes,
    },
  });
}

/** Records the step a code was accepted for, closing the replay window behind it. */
export async function recordTwoFactorStep(userId: string, step: number): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpLastStep: step } });
}

/**
 * Spends a recovery code — given its hash, which the caller computed — and says whether it
 * was one that had not been used.
 *
 * A conditional update rather than read-then-write: two requests submitting the same code at
 * once would both read it as present, and the second write would put back a list computed
 * before the first had removed anything. `updateMany` with the hash in its `where` makes the
 * database decide, and its count says who won.
 */
export async function consumeRecoveryCodeHash(userId: string, hash: string): Promise<boolean> {
  const state = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpRecoveryCodes: true },
  });
  if (!state?.totpRecoveryCodes.includes(hash)) return false;

  const { count } = await prisma.user.updateMany({
    where: { id: userId, totpRecoveryCodes: { has: hash } },
    data: { totpRecoveryCodes: state.totpRecoveryCodes.filter((stored) => stored !== hash) },
  });
  return count > 0;
}

export async function replaceRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpRecoveryCodes: hashes } });
}

/**
 * Turns 2FA off and leaves nothing behind.
 *
 * The secret goes too. Keeping it would mean a later "turn it back on" silently reused a
 * secret that has been on someone's phone — and possibly on a screenshot of a QR code — for
 * however long, which is not the guarantee "enable two-factor" makes.
 */
export async function disableTwoFactor(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecret: null,
      totpConfirmedAt: null,
      totpLastStep: null,
      totpRecoveryCodes: [],
    },
  });
}

// ---------------------------------------------------------------------------
// The sign-in challenge
// ---------------------------------------------------------------------------

/** Wrong codes a single challenge tolerates before it is destroyed. */
export const MAX_CHALLENGE_ATTEMPTS = 5;

export type ChallengeRecord = {
  id: string;
  userId: string;
  tenantId: string;
  email: string;
  attempts: number;
};

/**
 * Opens a challenge for a user whose password has just verified.
 *
 * Any earlier challenge for the same user is deleted first. They are one-per-sign-in by
 * nature, and leaving the old ones would mean a token from an abandoned attempt half an hour
 * ago still opened the door.
 */
export async function createTwoFactorChallenge(options: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.$transaction([
    prisma.twoFactorChallenge.deleteMany({ where: { userId: options.userId } }),
    prisma.twoFactorChallenge.create({
      data: {
        userId: options.userId,
        tokenHash: options.tokenHash,
        expiresAt: options.expiresAt,
      },
    }),
  ]);
}

/**
 * The challenge a token names, if it is live and belongs to this tenant.
 *
 * The tenant join is the same boundary `findSession` draws: a challenge token issued on one
 * client's domain must be inert on another's, even though one deployment serves both.
 */
export async function findTwoFactorChallenge(
  tokenHash: string,
  tenantId: string,
): Promise<ChallengeRecord | null> {
  const row = await prisma.twoFactorChallenge.findFirst({
    where: { tokenHash, expiresAt: { gt: new Date() }, user: { tenantId } },
    select: {
      id: true,
      attempts: true,
      user: { select: { id: true, tenantId: true, email: true } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user.id,
    tenantId: row.user.tenantId,
    email: row.user.email,
    attempts: row.attempts,
  };
}

/** Counts a wrong code, and reports whether that was the last one this challenge had. */
export async function failTwoFactorChallenge(id: string): Promise<{ exhausted: boolean }> {
  const row = await prisma.twoFactorChallenge.update({
    where: { id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

  if (row.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await prisma.twoFactorChallenge.delete({ where: { id } }).catch(() => undefined);
    return { exhausted: true };
  }
  return { exhausted: false };
}

export async function deleteTwoFactorChallenge(id: string): Promise<void> {
  await prisma.twoFactorChallenge.delete({ where: { id } }).catch(() => undefined);
}

/**
 * Drops challenges nobody completed. Called by the hourly sweep, alongside the other three.
 *
 * They are small and short-lived, but they are also written on every sign-in of every account
 * with 2FA on, and nothing else would ever delete the ones that were abandoned.
 */
export async function pruneExpiredTwoFactorChallenges(): Promise<number> {
  const { count } = await prisma.twoFactorChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}
