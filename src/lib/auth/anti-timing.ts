import 'server-only';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '@/lib/crypto/password';

/**
 * When the email doesn't exist we still run a full argon2 verification against a throwaway
 * hash. Without it, "unknown address" returns in a millisecond and "wrong password" takes
 * ~50ms — which is a perfectly usable oracle for finding out who has an account.
 */
let dummyHash: Promise<string> | null = null;

export async function burnPasswordVerification(candidate: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('hex'));
  await verifyPassword(await dummyHash, candidate);
}
