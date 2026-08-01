import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, safeEqual } from './secretbox';

describe('secretbox (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const secret = 'investor-password-123!';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('round-trips non-ASCII and empty input', () => {
    expect(decryptSecret(encryptSecret('סיסמה עברית'))).toBe('סיסמה עברית');
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('produces a different envelope every time (random nonce)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('never leaks the plaintext into the envelope', () => {
    expect(encryptSecret('hunter2')).not.toContain('hunter2');
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const envelope = encryptSecret('investor-password');
    const parts = envelope.split('.');
    const data = Buffer.from(parts[3]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    const tampered = [parts[0], parts[1], parts[2], data.toString('base64url')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects an unknown envelope version', () => {
    expect(() => decryptSecret('v9.a.b.c')).toThrow(/envelope/i);
    expect(() => decryptSecret('not-an-envelope')).toThrow(/envelope/i);
  });
});

describe('safeEqual', () => {
  it('compares equal and unequal values', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
