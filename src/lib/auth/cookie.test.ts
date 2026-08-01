import { describe, expect, it } from 'vitest';
import { generateToken } from '@/lib/crypto/tokens';
import { packCookie, unpackCookie } from './cookie';

describe('session cookie', () => {
  it('round-trips a token', () => {
    const token = generateToken();
    expect(unpackCookie(packCookie(token))).toBe(token);
  });

  it('rejects a cookie whose token was swapped', () => {
    const packed = packCookie(generateToken());
    const signature = packed.slice(packed.lastIndexOf('.') + 1);
    expect(unpackCookie(`${generateToken()}.${signature}`)).toBeNull();
  });

  it('rejects a cookie whose signature was tampered with', () => {
    const token = generateToken();
    const packed = packCookie(token);
    expect(unpackCookie(`${token}.notasignature`)).toBeNull();
    expect(unpackCookie(packed.slice(0, -2))).toBeNull();
  });

  it('rejects malformed and absent cookies without throwing', () => {
    expect(unpackCookie(undefined)).toBeNull();
    expect(unpackCookie('')).toBeNull();
    expect(unpackCookie('no-dot')).toBeNull();
    expect(unpackCookie('.onlysignature')).toBeNull();
  });

  it('binds the signature to the token, not just its length', () => {
    const a = packCookie('aaaa');
    const b = packCookie('bbbb');
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });
});
