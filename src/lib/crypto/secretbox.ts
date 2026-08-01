import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * AES-256-GCM envelope for the MT5 investor password (and anything else that must be
 * readable by the server but useless in a database dump).
 *
 * Format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url. The version prefix leaves
 * room to rotate the algorithm without guessing at what an old row contains.
 *
 * The key comes from ENCRYPTION_KEY (32 raw bytes, base64). Rotating it makes existing
 * ciphertexts undecryptable — users must reconnect their MT5 account. That trade-off is
 * documented in .env.example.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard.

function key(): Buffer {
  return Buffer.from(env().ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised secret envelope');
  }
  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time comparison for secrets compared outside a hash verify (e.g. tokens). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
