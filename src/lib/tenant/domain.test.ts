import { describe, expect, it } from 'vitest';
import { isValidDomain, normalizeDomain } from './domain';

describe('normalizeDomain', () => {
  it('lowercases and strips the port', () => {
    expect(normalizeDomain('Demo.TRi.App:443')).toBe('demo.tri.app');
    expect(normalizeDomain('demo.localhost:3000')).toBe('demo.localhost');
  });

  it('strips a scheme, a path and a trailing dot', () => {
    expect(normalizeDomain('https://demo.tri.app/login')).toBe('demo.tri.app');
    expect(normalizeDomain('demo.tri.app.')).toBe('demo.tri.app');
  });

  it('keeps IPv6 literals intact while dropping the port', () => {
    expect(normalizeDomain('[::1]:3000')).toBe('[::1]');
  });

  it('is idempotent', () => {
    const once = normalizeDomain('HTTPS://Demo.TRi.App:443/');
    expect(normalizeDomain(once)).toBe(once);
  });
});

describe('isValidDomain', () => {
  it('accepts real hostnames and dev hosts', () => {
    expect(isValidDomain('tri.app')).toBe(true);
    expect(isValidDomain('demo.tri.app')).toBe(true);
    expect(isValidDomain('demo.localhost')).toBe(true);
    expect(isValidDomain('localhost')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('has space.app')).toBe(false);
    expect(isValidDomain('-leading.app')).toBe(false);
    expect(isValidDomain('trailing-.app')).toBe(false);
    expect(isValidDomain('https://tri.app')).toBe(false);
    expect(isValidDomain('tri.app/login')).toBe(false);
  });
});
