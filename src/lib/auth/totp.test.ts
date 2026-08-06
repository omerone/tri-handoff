import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  formatSecretForEntry,
  generateTotpSecret,
  hotpCode,
  otpauthUri,
  totpCode,
  totpStep,
  TOTP_STEP_SECONDS,
  verifyTotp,
} from './totp';

/**
 * The RFC's own seed: the ASCII string "12345678901234567890", which is what its test-vector
 * tables are computed from. Authenticator apps take base32, so it goes in that way.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  // RFC 4648 §10.
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('encodes %o as %o', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain, 'ascii'))).toBe(encoded);
  });

  it('round-trips whatever it produced', () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });

  it('reads a secret back the way a person would have typed it', () => {
    const secret = generateTotpSecret();
    const typed = formatSecretForEntry(secret).toLowerCase();
    expect(base32Decode(typed)).toEqual(base32Decode(secret));
  });

  it('refuses a character that is not in the alphabet', () => {
    // 0, 1 and 8 are left out of base32 precisely because they are misread as O, I and B.
    expect(() => base32Decode('ABC0')).toThrow();
  });
});

describe('RFC 4226 test vectors', () => {
  // Appendix D, counters 0-9 against the same seed.
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i produces %s', (counter, expected) => {
    expect(hotpCode(RFC_SECRET, counter)).toBe(expected);
  });
});

describe('RFC 6238 test vectors', () => {
  /*
   * Appendix B, the SHA-1 rows. The table prints eight digits; this implementation emits the
   * six an authenticator shows, which are the last six of the same number — the digit count
   * is a modulo at the very end of the algorithm and changes nothing before it.
   */
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at unix time %i the code is %s', (seconds, eightDigits) => {
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(eightDigits.slice(-6));
  });
});

describe('verifyTotp', () => {
  const at = 1_700_000_000_000;

  it('accepts the code for the current step', () => {
    const verdict = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at), { atMs: at });
    expect(verdict).toEqual({ ok: true, step: totpStep(at) });
  });

  it('accepts one step either side, for a phone whose clock has drifted', () => {
    const stepMs = TOTP_STEP_SECONDS * 1000;
    for (const offset of [-stepMs, stepMs]) {
      const code = totpCode(RFC_SECRET, at + offset);
      expect(verifyTotp(RFC_SECRET, code, { atMs: at }).ok).toBe(true);
    }
  });

  it('refuses two steps away, so a code is not usable for minutes', () => {
    const code = totpCode(RFC_SECRET, at + 2 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, code, { atMs: at })).toEqual({ ok: false, reason: 'wrong' });
  });

  it('refuses a code that has already been spent', () => {
    const first = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at), { atMs: at });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at), {
      atMs: at,
      lastStep: first.step,
    });
    expect(replay).toEqual({ ok: false, reason: 'replayed' });
  });

  it('refuses the previous step once a later one has been used', () => {
    // The window reaches backwards, so without the guard the code from thirty seconds ago
    // would still verify after the current one had been accepted.
    const used = totpStep(at);
    const previous = totpCode(RFC_SECRET, at - TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, previous, { atMs: at, lastStep: used })).toEqual({
      ok: false,
      reason: 'replayed',
    });
  });

  it('still accepts the next step after one has been used', () => {
    const used = totpStep(at);
    const next = totpCode(RFC_SECRET, at + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(RFC_SECRET, next, { atMs: at, lastStep: used }).ok).toBe(true);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 34 56 78'])(
    'rejects %o as malformed rather than wrong',
    (submitted) => {
      expect(verifyTotp(RFC_SECRET, submitted, { atMs: at })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    },
  );

  it('ignores spaces inside an otherwise valid code', () => {
    const code = totpCode(RFC_SECRET, at);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced, { atMs: at }).ok).toBe(true);
  });

  it('rejects a code from a different secret', () => {
    const other = generateTotpSecret();
    expect(verifyTotp(RFC_SECRET, totpCode(other, at), { atMs: at })).toEqual({
      ok: false,
      reason: 'wrong',
    });
  });
});

describe('otpauthUri', () => {
  it('carries the issuer in both places the Key URI format puts it', () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: 'demo@tri.local', issuer: 'TRi' });
    const parsed = new URL(uri);

    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/TRi:demo@tri.local');
    expect(parsed.searchParams.get('issuer')).toBe('TRi');
    expect(parsed.searchParams.get('secret')).toBe(RFC_SECRET);
  });

  it('states the three parameters an app would otherwise have to assume', () => {
    const params = new URL(
      otpauthUri({ secret: RFC_SECRET, account: 'a@b.c', issuer: 'TRi' }),
    ).searchParams;
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});

describe('generateTotpSecret', () => {
  it('is 160 bits, which is what RFC 6238 recommends for HMAC-SHA1', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('does not repeat', () => {
    const secrets = new Set(Array.from({ length: 50 }, generateTotpSecret));
    expect(secrets.size).toBe(50);
  });
});
