import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque bearer tokens for session cookies and password-reset links.
 *
 * The raw token is handed to the user exactly once; only its SHA-256 is stored. SHA-256 is
 * the right primitive here (unlike for passwords): the token is 256 bits of CSPRNG output,
 * so there is nothing to brute-force and a slow KDF would only cost latency on every
 * request.
 */

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
