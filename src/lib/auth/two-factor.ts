import 'server-only';
import { cookies } from 'next/headers';
import { decryptSecret, encryptSecret } from '@/lib/crypto/secretbox';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import {
  consumeRecoveryCodeHash,
  deleteTwoFactorChallenge,
  createTwoFactorChallenge,
  failTwoFactorChallenge,
  findTwoFactorChallenge,
  getTwoFactorState,
  recordTwoFactorStep,
  type ChallengeRecord,
} from '@/lib/db/two-factor';
import {
  cookieOptions,
  packCookie,
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_TTL_MS,
  unpackCookie,
} from './cookie';
import { looksLikeRecoveryCode, normalizeRecoveryCode } from './recovery-codes';
import { verifyTotp } from './totp';

/**
 * The half-authenticated state, and the one place a second factor is judged.
 *
 * Between `@/lib/auth/totp.ts`, which is arithmetic and knows nothing about this app, and
 * `src/app/(auth)/actions.ts`, which knows about forms. This layer owns the two things that
 * are neither: where the challenge lives while the browser is being asked for a code, and
 * what counts as passing it.
 *
 * The secret is decrypted here and nowhere else. It arrives from the database encrypted with
 * `ENCRYPTION_KEY` — the same envelope as the MT5 investor password — so a dump of `users`
 * without the key yields no working authenticator.
 */

export type ChallengeOutcome =
  | { status: 'passed'; userId: string }
  | { status: 'wrong' }
  | { status: 'exhausted' }
  | { status: 'expired' };

/** Whether this account will be asked for a code after its password. */
export async function twoFactorIsOn(userId: string): Promise<boolean> {
  const state = await getTwoFactorState(userId);
  return Boolean(state?.confirmedAt && state.secret);
}

/**
 * Opens a challenge and puts its token in the browser.
 *
 * Called *instead of* `startSession`, never alongside it. The distinction is the entire point
 * of the feature: until a code verifies there is no session, so nothing that reads one can be
 * fooled by a half-finished sign-in.
 */
export async function startTwoFactorChallenge(userId: string): Promise<void> {
  const token = generateToken();
  await createTwoFactorChallenge({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TWO_FACTOR_TTL_MS),
  });

  const store = await cookies();
  // Signed by the same helper the session cookie uses, so a junk value is rejected on an HMAC
  // rather than on a query.
  store.set(TWO_FACTOR_COOKIE, packCookie(token), cookieOptions(TWO_FACTOR_TTL_MS / 1000));
}

/** The challenge this browser is holding, if it is live and belongs to this tenant. */
export async function pendingChallenge(tenantId: string): Promise<ChallengeRecord | null> {
  const token = await challengeToken();
  if (!token) return null;
  return findTwoFactorChallenge(hashToken(token), tenantId);
}

export async function clearTwoFactorChallenge(): Promise<void> {
  const store = await cookies();
  store.set(TWO_FACTOR_COOKIE, '', cookieOptions(0));
}

/**
 * Judges a submitted code against a live challenge.
 *
 * Accepts either an authenticator code or a recovery code, decided by shape rather than by
 * asking the trader which one they are typing — the two cannot be confused (six digits versus
 * ten letters), and someone locked out is not in a mood to pick the right form.
 *
 * A wrong code counts against the challenge and, on the last attempt, destroys it: the next
 * try costs the password again. That is what stops a stolen password from becoming an
 * unlimited guessing budget against a six-digit space.
 *
 * Deleting the challenge on success is not tidying-up. Without it the token in the cookie
 * stays valid for its whole five minutes, and a code is only single-use because
 * `recordTwoFactorStep` says so — two uses of one challenge is one sign-in too many.
 */
export async function answerChallenge(
  challenge: ChallengeRecord,
  submitted: string,
): Promise<ChallengeOutcome> {
  const state = await getTwoFactorState(challenge.userId);
  if (!state?.secret || !state.confirmedAt) {
    // 2FA was turned off in another tab while this challenge was open. The password already
    // verified, so there is nothing left to ask for.
    await deleteTwoFactorChallenge(challenge.id);
    await clearTwoFactorChallenge();
    return { status: 'passed', userId: challenge.userId };
  }

  const entered = submitted.trim();

  if (looksLikeRecoveryCode(entered)) {
    // Hashed here, not in the query layer: `@/lib/db` is reachable from the Edge bundle and
    // may not import `node:crypto`. See the header of db/two-factor.ts.
    const hash = hashToken(normalizeRecoveryCode(entered));
    if (await consumeRecoveryCodeHash(challenge.userId, hash)) {
      await deleteTwoFactorChallenge(challenge.id);
      await clearTwoFactorChallenge();
      return { status: 'passed', userId: challenge.userId };
    }
    return fail(challenge);
  }

  const verdict = verifyTotp(decryptSecret(state.secret), entered, {
    atMs: Date.now(),
    lastStep: state.lastStep,
  });
  if (!verdict.ok) return fail(challenge);

  await recordTwoFactorStep(challenge.userId, verdict.step);
  await deleteTwoFactorChallenge(challenge.id);
  await clearTwoFactorChallenge();
  return { status: 'passed', userId: challenge.userId };
}

async function fail(challenge: ChallengeRecord): Promise<ChallengeOutcome> {
  const { exhausted } = await failTwoFactorChallenge(challenge.id);
  if (exhausted) {
    await clearTwoFactorChallenge();
    return { status: 'exhausted' };
  }
  return { status: 'wrong' };
}

// ---------------------------------------------------------------------------
// Setup, from inside a session
// ---------------------------------------------------------------------------

/** Encrypts a freshly generated secret for storage. Thin, but it keeps the envelope in one file. */
export function sealSecret(secret: string): string {
  return encryptSecret(secret);
}

export function openSecret(encrypted: string): string {
  return decryptSecret(encrypted);
}

async function challengeToken(): Promise<string | null> {
  const store = await cookies();
  return unpackCookie(store.get(TWO_FACTOR_COOKIE)?.value);
}
