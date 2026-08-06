import 'server-only';
import { randomInt } from 'node:crypto';
import { hashToken } from '@/lib/crypto/tokens';

/**
 * The way back in when the phone is gone.
 *
 * Without these, turning 2FA on is a promise that a lost, wiped or stolen phone locks the
 * trader out of their own book permanently — and on this deployment the only other way back
 * is a password reset email that goes nowhere, so it would be permanent in the literal sense.
 * That is why the setup flow does not finish without showing them.
 *
 * Stored as SHA-256, like session and reset tokens and for the same reason: these are CSPRNG
 * output with no structure to guess at, so a slow KDF would buy nothing and cost latency on a
 * path someone reaches while already locked out.
 */

/** How many are issued at once. Ten is enough to survive several losses without a reset. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * The alphabet, missing the characters people confuse when copying off a screen.
 *
 * No 0/O, no 1/I/L, no 2/Z, no 5/S, no 8/B. These are read off a screen and typed on a phone
 * keyboard by someone who has just lost access to their account, which is the worst moment to
 * discover that a zero was an O.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY3467';

/** Characters per group, and groups per code — `XXXXX-XXXXX`, 10 characters of entropy. */
const GROUP = 5;
const GROUPS = 2;

/**
 * `randomInt` rather than `randomBytes` and a modulo: the alphabet's length does not divide
 * 256, so folding a byte into it would make the first eight characters slightly likelier than
 * the rest. `randomInt` rejects and re-draws instead, which is uniform.
 */
function codeWord(): string {
  let word = '';
  for (let index = 0; index < GROUP * GROUPS; index += 1) {
    if (index > 0 && index % GROUP === 0) word += '-';
    word += ALPHABET[randomInt(ALPHABET.length)];
  }
  return word;
}

export type RecoveryCodeSet = {
  /** Shown to the trader exactly once, at the moment they are generated. */
  plain: string[];
  /** What goes in the database. */
  hashes: string[];
};

export function generateRecoveryCodes(): RecoveryCodeSet {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, codeWord);
  return { plain, hashes: plain.map((code) => hashToken(normalizeRecoveryCode(code))) };
}

/**
 * What a typed code has to be turned into before it is hashed and compared.
 *
 * Upper-cased, with spaces and hyphens dropped, so the separator that exists to make the code
 * readable is not also something to get wrong — and so "acdef ghjkm", "ACDEF-GHJKM" and
 * "acdefghjkm" are the same code, because to the person typing them they are.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** Shape check before a lookup, so a stray password submitted here is not hashed and searched. */
export function looksLikeRecoveryCode(code: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${GROUP * GROUPS}}$`).test(normalizeRecoveryCode(code));
}
