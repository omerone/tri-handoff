import 'server-only';
import { hash, verify, type Options } from '@node-rs/argon2';

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

export const MIN_PASSWORD_LENGTH = 10;

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
