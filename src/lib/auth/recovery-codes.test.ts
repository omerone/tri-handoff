import { describe, expect, it } from 'vitest';
import { hashToken } from '@/lib/crypto/tokens';
import {
  generateRecoveryCodes,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './recovery-codes';

describe('generateRecoveryCodes', () => {
  it('issues the documented number of codes', () => {
    expect(generateRecoveryCodes().plain).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('hashes what a person would actually type, not what is printed', () => {
    // The hyphen is presentation. Hashing the printed form would mean a code typed without
    // it — which is how half the people will type it — never matched.
    const { plain, hashes } = generateRecoveryCodes();
    plain.forEach((code, index) => {
      expect(hashes[index]).toBe(hashToken(normalizeRecoveryCode(code)));
      expect(hashes[index]).not.toBe(hashToken(code));
    });
  });

  it('stores nothing a database leak could read back', () => {
    const { plain, hashes } = generateRecoveryCodes();
    for (const code of plain) expect(hashes).not.toContain(code);
  });

  it('never repeats a code within a set', () => {
    const { plain } = generateRecoveryCodes();
    expect(new Set(plain).size).toBe(plain.length);
  });

  it('leaves out the characters that are misread off a screen', () => {
    // 200 codes is 4,000 characters — if any of these were in the alphabet it would appear.
    const everything = Array.from({ length: 200 }, () => generateRecoveryCodes().plain.join(''))
      .join('')
      .replace(/-/g, '');
    for (const confusable of ['0', 'O', '1', 'I', 'L', '2', 'Z', '5', 'S', '8', 'B']) {
      expect(everything, `${confusable} is confusable and should not be in the alphabet`)
        .not.toContain(confusable);
    }
  });
});

describe('normalizeRecoveryCode', () => {
  it.each([
    ['ACDEF-GHJKM', 'ACDEFGHJKM'],
    ['acdef-ghjkm', 'ACDEFGHJKM'],
    ['acdef ghjkm', 'ACDEFGHJKM'],
    ['  ACDEFGHJKM  ', 'ACDEFGHJKM'],
  ])('reads %o the same as the printed code', (typed, expected) => {
    expect(normalizeRecoveryCode(typed)).toBe(expected);
  });
});

describe('looksLikeRecoveryCode', () => {
  it('accepts every code it generates, however it is typed back', () => {
    for (const code of generateRecoveryCodes().plain) {
      expect(looksLikeRecoveryCode(code)).toBe(true);
      expect(looksLikeRecoveryCode(code.toLowerCase())).toBe(true);
      expect(looksLikeRecoveryCode(normalizeRecoveryCode(code))).toBe(true);
    }
  });

  it.each([
    ['', 'empty'],
    ['123456', 'a TOTP code'],
    ['ACDEFGHJK', 'one character short'],
    ['ACDEFGHJKMN', 'one character long'],
    ['ACDEFGHJK0', 'a character outside the alphabet'],
    ['correct horse battery staple', 'a password'],
  ])('rejects %o (%s)', (input) => {
    expect(looksLikeRecoveryCode(input)).toBe(false);
  });
});
