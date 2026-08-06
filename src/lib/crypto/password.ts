import 'server-only';
import { hash, verify, type Options } from '@node-rs/argon2';
// `zxcvbn` v4 is a single CommonJS function with no named exports — the `{ zxcvbn,
// zxcvbnOptions }` shape belongs to `@zxcvbn-ts/core`, a different package. Importing it
// that way left `zxcvbnOptions` undefined and threw on module evaluation, which took down
// every route that reaches this file: the login page 500ed before it rendered.
import zxcvbn from 'zxcvbn';

/**
 * `Algorithm` is an ambient `const enum`, which `isolatedModules` forbids importing as a
 * value. 2 is `Algorithm.Argon2id` — the memory-hard, side-channel-resistant variant the
 * brief asks for. Asserted against a hash prefix in password.test.ts.
 */
const ARGON2ID = 2 as NonNullable<Options['algorithm']>;

/**
 * Password hashing — argon2id, per the brief.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet's argon2id recommendation
 * (19 MiB memory, 2 iterations, 1 degree of parallelism). They are encoded into the hash
 * string, so raising them later still verifies old hashes.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_LENGTH = 12; // Increased from 10 to 12 for strength validation
export const MIN_PASSWORD_STRENGTH_SCORE = 3; // zxcvbn score: 3 = good, 4 = strong

/**
 * The ceiling, and it is a denial-of-service control rather than a policy.
 *
 * Argon2 does not care how long a password is — it digests it to a fixed size before the
 * memory-hard work, and verifying a one-million-character string takes the same 17ms as
 * verifying twelve. Measured, because the opposite is widely assumed.
 *
 * zxcvbn cares enormously. Its matchers walk every substring against several dictionaries,
 * and the cost is superlinear. Measured on this machine, with the same call the reset flow
 * makes:
 *
 *     12 chars        4 ms
 *    100 chars       34 ms
 *  1,000 chars    9,339 ms
 *  5,000 chars    did not finish in nine minutes
 *
 * Node runs one thread. Nine seconds is not a slow request, it is the entire site frozen for
 * nine seconds — every other user's page, the health check the deploy rolls back on, the
 * maintenance sweep. A server action's body may be a megabyte by default, so the field this
 * arrives in has room for a thousand times the input that already costs nine seconds.
 *
 * 128 is the usual answer and far past any real passphrase; nothing a person types is
 * refused. The check lives in `analyzePasswordStrength` rather than only in the schemas
 * above it, because a call site is a thing someone adds later without reading this.
 */
export const MAX_PASSWORD_LENGTH = 128;

// No global configuration step: v4 takes the user's own words as the second argument to each
// call, which is where they belong — the email to penalise differs per password checked.

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed stored hash, so a corrupt row is a
 * failed login instead of a 500 that reveals the account exists.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Password Strength Validation using zxcvbn
 *
 * Validates password against multiple attack vectors:
 * - Dictionary attacks (common words, patterns)
 * - Spatial patterns (adjacent keyboard keys)
 * - Repeating/sequential characters
 * - User-related information (email, username)
 *
 * Score explanation:
 * - 0: Too weak (< 3 guesses) ❌
 * - 1: Weak (3-6 guesses) ❌
 * - 2: Fair (6-8 guesses) ❌
 * - 3: Good (8-10 guesses) ✅ minimum acceptable for TRi
 * - 4: Strong (> 10 guesses) ✅
 */

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  feedback: {
    warning: string;
    suggestions: string[];
  };
  isStrong: boolean;
  guessesLog10: number;
}

/**
 * Analyze password strength
 * Does not throw; caller decides what to do with result
 */
export function analyzePasswordStrength(
  password: string,
  userInputs: string[] = [],
): PasswordStrengthResult {
  // Quick check: minimum length
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      score: 0,
      feedback: {
        warning: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        suggestions: [],
      },
      isStrong: false,
      guessesLog10: 0,
    };
  }

  // Before zxcvbn, never after — see MAX_PASSWORD_LENGTH. Past this the analysis is the
  // attack, and returning "too long" is both the honest answer and the cheap one.
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      score: 0,
      feedback: {
        warning: `Password must be at most ${MAX_PASSWORD_LENGTH} characters`,
        suggestions: [],
      },
      isStrong: false,
      guessesLog10: 0,
    };
  }

  // Run zxcvbn analysis
  const result = zxcvbn(password, userInputs);

  return {
    score: result.score as 0 | 1 | 2 | 3 | 4,
    feedback: result.feedback,
    isStrong: result.score >= MIN_PASSWORD_STRENGTH_SCORE,
    // v4 reports this in snake_case.
    guessesLog10: result.guesses_log10,
  };
}

/**
 * Assert password meets strength requirements
 * Throws if password fails strength check
 *
 * Usage: validatePasswordStrength(password, [userEmail])
 */
export function validatePasswordStrength(password: string, userInputs: string[] = []): void {
  const result = analyzePasswordStrength(password, userInputs);

  if (!result.isStrong) {
    const msg = result.feedback.warning || 'Password is not strong enough';
    const suggestion =
      result.feedback.suggestions[0] ||
      'Try using a mix of uppercase, lowercase, numbers, and symbols';

    throw new Error(`${msg}. ${suggestion}`);
  }
}
