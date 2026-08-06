import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * Written here rather than taken from a package because the whole algorithm is the forty
 * lines below — an HMAC, a truncation and a modulo — and every published implementation is a
 * wrapper around the same `node:crypto` calls plus a dependency tree. The RFC ships test
 * vectors, so this is one of the few pieces of security code that can be proved correct
 * against the standard itself rather than against our own reading of it; `totp.test.ts` runs
 * all six of them.
 *
 * Pure and free of I/O on purpose: nothing here reads a clock it was not given, so every
 * behaviour that depends on time — the window, the replay guard, an expired challenge — is
 * exercised in tests at an exact instant instead of near one.
 *
 * SHA-1 is not a mistake and not legacy debt. RFC 6238 defines TOTP over HMAC-SHA1, and it
 * is what Google Authenticator, 1Password, Authy and every other scanner assume when the URI
 * omits `algorithm`. HMAC does not rest on collision resistance, which is the property SHA-1
 * lost; a stronger digest here would only produce codes no authenticator app can generate.
 */

/** Seconds a code is valid for. Thirty is the RFC default and what every app assumes. */
export const TOTP_STEP_SECONDS = 30;

/** Digits in a code. Six is the RFC default and what every app displays. */
export const TOTP_DIGITS = 6;

/**
 * Steps either side of now that still verify.
 *
 * One, so a code entered as it rolls over — or typed on a phone whose clock is half a minute
 * out — is accepted. That makes a code usable for at most 90 seconds. Wider windows are how
 * people paper over unsynchronised clocks, and each extra step is another half-minute an
 * intercepted code stays worth having.
 */
const WINDOW_STEPS = 1;

/** 160 bits, the RFC's recommendation for HMAC-SHA1 and what every authenticator expects. */
const SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — the encoding authenticator apps read secrets in. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return output;
}

/**
 * The inverse. Tolerant of padding, spaces and lower case, because the manual-entry path
 * hands people a grouped string to type and they type it back the way they read it.
 */
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Not a base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** The counter a moment falls in. Exported because the replay guard stores one. */
export function totpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * HOTP (RFC 4226) at a given counter — the primitive TOTP is a clock on top of.
 *
 * The dynamic truncation and the `& 0x7fffffff` are from the RFC verbatim: the mask drops the
 * sign bit so the result is the same on platforms that read the four bytes as signed.
 */
export function hotpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const message = Buffer.alloc(8);
  // A counter is 64-bit in the RFC; JavaScript numbers hold it exactly until the year 4000,
  // and BigInt would buy nothing but a cast on every call.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code an authenticator would be showing at `atMs`. */
export function totpCode(secret: string, atMs: number): string {
  return hotpCode(secret, totpStep(atMs));
}

export type TotpVerdict =
  | { ok: true; step: number }
  | { ok: false; reason: 'malformed' | 'wrong' | 'replayed' };

/**
 * Whether a submitted code is the one this secret is producing.
 *
 * `lastStep` is the replay guard and is the reason this returns the step it matched rather
 * than a boolean. A TOTP code is valid for its whole step and then for another through the
 * window, so a code read over someone's shoulder — or off an unencrypted connection, which is
 * what this deployment still is — can be replayed for up to ninety seconds. Recording the
 * step each success matched, and refusing anything at or below it, makes every code single-use
 * in fact and not only in name. The caller persists it; this function stays pure.
 *
 * The comparison is constant-time. The margin it protects is small — a six-digit space is
 * brute-forced by guessing, not by timing — but a length-dependent early return is exactly
 * the habit that matters somewhere else later.
 */
export function verifyTotp(
  secret: string,
  submitted: string,
  options: { atMs: number; lastStep?: number | null },
): TotpVerdict {
  const cleaned = submitted.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(cleaned)) return { ok: false, reason: 'malformed' };

  const now = totpStep(options.atMs);
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const step = now + offset;
    if (step < 0) continue;
    if (!constantTimeEqual(hotpCode(secret, step), cleaned)) continue;
    // Matched, but this code — or one from the same window — has already been spent.
    if (options.lastStep !== null && options.lastStep !== undefined && step <= options.lastStep) {
      return { ok: false, reason: 'replayed' };
    }
    return { ok: true, step };
  }

  return { ok: false, reason: 'wrong' };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The `otpauth://` URI a QR code carries.
 *
 * The label is `issuer:account` and `issuer` is *also* a parameter — duplication the Key URI
 * format asks for, because older apps read one and newer ones read the other, and an app that
 * reads neither files the account under a blank heading. Both are percent-encoded: an email
 * address is the account here and `@` is legal in a path segment but not worth relying on.
 *
 * `algorithm`, `digits` and `period` are emitted even though all three are the defaults. An
 * app that assumes different ones produces codes that never verify, and the failure looks
 * exactly like a wrong password — being explicit costs three parameters.
 */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.account)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * The secret as a human types it, in groups of four.
 *
 * The manual-entry path exists for a phone that cannot scan, and a 32-character unbroken run
 * of letters and digits is transcribed wrong more often than right.
 */
export function formatSecretForEntry(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}
