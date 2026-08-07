import { afterEach, describe, expect, it, vi } from 'vitest';
import type { env as envFn } from './env';

/**
 * The environment rules that decide whether this deployment may invent data.
 *
 * `MT5_PROVIDER` defaults to `mock`, and the mock is not a stub that returns nothing — it
 * accepts any account number with any password and answers with a generated book and a
 * generated balance. That is exactly right in development and a lie in production, where a
 * trader types their real account number, is told it connected, and is shown dozens of trades
 * that never happened.
 *
 * `docker-compose.yml` reads `${MT5_PROVIDER:-mock}`, so the wrong value is one unset variable
 * away on every deploy, and this deployment has already carried invented trades once. The rule
 * is therefore worth a test of its own rather than a comment.
 */

const REQUIRED = {
  DATABASE_URL: 'postgresql://tri:tri@localhost:5432/tri',
  SESSION_SECRET: Buffer.alloc(32, 1).toString('base64'),
  ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
};

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

/** The real signature of `env`, so the assertions below can read fields off its result. */
type EnvFn = typeof envFn;

/** A fresh copy of the module against a fresh environment — `env()` memoises per module. */
async function envWith(overrides: Record<string, string>): Promise<EnvFn> {
  vi.resetModules();
  // Cleared rather than merged: the ambient environment running this suite already sets
  // several of these, and a test that only ever adds cannot assert on a default.
  for (const key of ['NODE_ENV', 'MT5_PROVIDER', 'METAAPI_TOKEN', 'QUOTES_PROVIDER']) {
    delete process.env[key];
  }
  Object.assign(process.env, REQUIRED, overrides);
  const loaded = await import('./env');
  return loaded.env;
}

describe('the mock broker in production', () => {
  it('is refused, even though it is the default', async () => {
    const env = await envWith({ NODE_ENV: 'production' });
    expect(env).toThrow(/MT5_PROVIDER=mock is refused in production/);
  });

  it('is refused when it was asked for explicitly', async () => {
    const env = await envWith({ NODE_ENV: 'production', MT5_PROVIDER: 'mock' });
    expect(env).toThrow(/refused in production/);
  });

  it('says what to set instead, because the message is the whole fix', async () => {
    const env = await envWith({ NODE_ENV: 'production' });
    expect(env).toThrow(/MT5_PROVIDER=metaapi with METAAPI_TOKEN/);
  });

  it('allows the real provider in production when it has a token', async () => {
    const env = await envWith({
      NODE_ENV: 'production',
      MT5_PROVIDER: 'metaapi',
      METAAPI_TOKEN: 'token',
    });
    expect(env().MT5_PROVIDER).toBe('metaapi');
  });

  it('still refuses the real provider with no token', async () => {
    const env = await envWith({ NODE_ENV: 'production', MT5_PROVIDER: 'metaapi' });
    expect(env).toThrow(/requires METAAPI_TOKEN/);
  });

  // Development and the test suite both need the mock: it is what makes a checkout runnable
  // with no broker account, and what makes the e2e suite deterministic.
  it('is left alone outside production', async () => {
    expect((await envWith({ NODE_ENV: 'development' }))().MT5_PROVIDER).toBe('mock');
    expect((await envWith({ NODE_ENV: 'test' }))().MT5_PROVIDER).toBe('mock');
  });
});
