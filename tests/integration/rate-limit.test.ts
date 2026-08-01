import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { consumeRateLimit, resetRateLimit } from '@/lib/db';
import { testDb } from '../helpers/fixtures';

const keys: string[] = [];
const freshKey = () => {
  const key = `test:${randomBytes(8).toString('hex')}`;
  keys.push(key);
  return key;
};

afterAll(async () => {
  await testDb.rateLimit.deleteMany({ where: { key: { in: keys } } });
  await testDb.$disconnect();
});

describe('rate limiting', () => {
  it('allows up to the limit and then refuses', async () => {
    const key = freshKey();
    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimit(key, 3, 60_000)).allowed).toBe(true);
    }
    const blocked = await consumeRateLimit(key, 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it('reports the remaining budget', async () => {
    const key = freshKey();
    expect((await consumeRateLimit(key, 5, 60_000)).remaining).toBe(4);
    expect((await consumeRateLimit(key, 5, 60_000)).remaining).toBe(3);
  });

  it('starts a fresh window once the old one has expired', async () => {
    const key = freshKey();
    expect((await consumeRateLimit(key, 1, 1)).allowed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((await consumeRateLimit(key, 1, 60_000)).allowed).toBe(true);
  });

  it('keeps buckets independent', async () => {
    const a = freshKey();
    const b = freshKey();
    await consumeRateLimit(a, 1, 60_000);
    expect((await consumeRateLimit(a, 1, 60_000)).allowed).toBe(false);
    expect((await consumeRateLimit(b, 1, 60_000)).allowed).toBe(true);
  });

  it('clears a bucket on reset — a successful login must not leave the user locked out', async () => {
    const key = freshKey();
    await consumeRateLimit(key, 1, 60_000);
    expect((await consumeRateLimit(key, 1, 60_000)).allowed).toBe(false);

    await resetRateLimit(key);
    expect((await consumeRateLimit(key, 1, 60_000)).allowed).toBe(true);
  });

  it('handles concurrent attempts without erroring and without exceeding the limit', async () => {
    const key = freshKey();
    const verdicts = await Promise.all(
      Array.from({ length: 8 }, () => consumeRateLimit(key, 3, 60_000)),
    );
    // Every call must return a verdict — a rate limiter that throws under load is worse
    // than none — and exactly `limit` of them may be allowed.
    expect(verdicts).toHaveLength(8);
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(3);
  });
});
