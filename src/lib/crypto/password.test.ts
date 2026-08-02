import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  analyzePasswordStrength,
  validatePasswordStrength,
  MIN_PASSWORD_STRENGTH_SCORE,
} from './password';

describe('password hashing', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password')).toBe(true);
    expect(await verifyPassword(b, 'same-password')).toBe(true);
  });

  it('returns false rather than throwing on a corrupt stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('requires a non-trivial minimum length', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });
});

describe('password strength validation', () => {
  it('rejects passwords below minimum length', () => {
    const result = analyzePasswordStrength('short');
    expect(result.isStrong).toBe(false);
    expect(result.feedback.warning).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('rejects common weak passwords', () => {
    const weakPasswords = ['password123', 'abc123456789', 'qwerty123456', '111111111111'];

    for (const pwd of weakPasswords) {
      const result = analyzePasswordStrength(pwd);
      expect(result.isStrong).toBe(false);
    }
  });

  it('accepts strong passwords', () => {
    const strongPasswords = [
      'CorrectHorseBatteryStaple123!',
      'MyT0wn!FavoriteColor#2025',
      'Dancing7ThroughThePond&Rain',
    ];

    for (const pwd of strongPasswords) {
      const result = analyzePasswordStrength(pwd);
      expect(result.isStrong).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(MIN_PASSWORD_STRENGTH_SCORE);
    }
  });

  it('provides feedback for weak passwords', () => {
    const result = analyzePasswordStrength('123456789012');
    expect(result.feedback.warning).toBeDefined();
  });

  it('calculates guessesLog10 correctly', () => {
    const weak = analyzePasswordStrength('111111111111');
    const strong = analyzePasswordStrength('CorrectHorseBatteryStaple123!');

    expect(weak.guessesLog10).toBeLessThan(strong.guessesLog10);
  });

  it('validatePasswordStrength throws for weak passwords', () => {
    expect(() => validatePasswordStrength('password')).toThrow();
    expect(() => validatePasswordStrength('123456789012')).toThrow();
  });

  it('validatePasswordStrength accepts strong passwords', () => {
    expect(() => validatePasswordStrength('CorrectHorseBatteryStaple123!')).not.toThrow();
  });

  it('considers user inputs when validating', () => {
    // A password that's just the email with numbers shouldn't be strong
    expect(() =>
      validatePasswordStrength('testuser@example.com123456', ['testuser@example.com'])
    ).toThrow();
  });
});
