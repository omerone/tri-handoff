import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbContext from '@/lib/db/context';
import type { SessionRecord } from '@/lib/db/sessions';
import type { TenantLookup } from '@/lib/db/tenants';

/**
 * The session gate, exercised without a database or a request.
 *
 * `getSession` is where a cookie becomes an identity, so the interesting cases are the ones
 * where it must refuse: a cookie replayed on another client's domain, a tenant that has
 * been suspended since the cookie was issued, a forged signature. Those paths are cheap to
 * get wrong in a refactor and impossible to see in a passing smoke test, because every one
 * of them fails *open* into somebody else's account.
 */

// --- request doubles --------------------------------------------------------

type CookieEntry = { value: string; options?: Record<string, unknown> };

const cookieJar = new Map<string, CookieEntry>();
const requestHeaders = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const entry = cookieJar.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieJar.set(name, { value, options });
    },
  }),
  headers: async () => ({
    get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null,
  }),
}));

class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

const resolveTenant = vi.fn<() => Promise<TenantLookup>>();
vi.mock('@/lib/tenant/resolve', () => ({ resolveTenant: () => resolveTenant() }));

const findSession = vi.fn<(tokenHash: string, tenantId: string) => Promise<SessionRecord | null>>();
const createSession = vi.fn();
const touchSession = vi.fn();
const deleteSession = vi.fn();

// Session storage lives in the unscoped module — it runs before a TenantContext exists.
vi.mock('@/lib/db/unscoped', async () => ({
  // The real branded-context constructor: its validation is part of what getSession relies on.
  ...(await vi.importActual<typeof DbContext>('@/lib/db/context')),
  findSession: (...args: [string, string]) => findSession(...args),
  createSession: (...args: unknown[]) => createSession(...args),
  touchSession: (...args: unknown[]) => touchSession(...args),
  deleteSession: (...args: unknown[]) => deleteSession(...args),
}));

const { hashToken } = await import('@/lib/crypto/tokens');
const { SESSION_COOKIE, SESSION_COOKIE_MAX_AGE_MS, packCookie, unpackCookie } =
  await import('./cookie');
const { SESSION_IDLE_TTL_MS, SESSION_REFRESH_AFTER_MS } = await import('./session-limits');
const { endSession, getSession, requireSession, startSession } = await import('./session');

// --- fixtures ---------------------------------------------------------------

const TENANT = { id: 'tenant-alice', name: 'Alice', domain: 'alice.itest' };

const activeTenant: TenantLookup = { state: 'active', tenant: TENANT };

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sess-1',
    userId: 'user-1',
    tenantId: TENANT.id,
    email: 'alice@example.test',
    locale: 'he',
    displayCurrency: 'ILS',
    autoSyncOnLogin: false,
    theme: 'dark',
    lastLoginAt: null,
    tenantName: TENANT.name,
    tenantDomain: TENANT.domain,
    tenantStatus: 'active',
    expiresAt: new Date(Date.now() + SESSION_IDLE_TTL_MS),
    createdAt: new Date(),
    ...overrides,
  };
}

/** Puts a validly signed cookie in the jar and returns the raw token it carries. */
function signIn(token = 'a-random-token'): string {
  cookieJar.set(SESSION_COOKIE, { value: packCookie(token) });
  return token;
}

beforeEach(() => {
  cookieJar.clear();
  requestHeaders.clear();
  vi.clearAllMocks();
  resolveTenant.mockResolvedValue(activeTenant);
  findSession.mockResolvedValue(record());
});

// --- tests ------------------------------------------------------------------

describe('getSession', () => {
  it('returns the session of the tenant resolved from the host', async () => {
    const token = signIn();
    const session = await getSession();

    expect(findSession).toHaveBeenCalledWith(hashToken(token), TENANT.id);
    expect(session?.tenant).toEqual(TENANT);
    expect(session?.user).toEqual({
      id: 'user-1',
      email: 'alice@example.test',
      locale: 'he',
      displayCurrency: 'ILS',
      theme: 'dark',
      // Carried on the session so the shell can decide, without a second query, whether a
      // login-triggered sync is owed — see components/shell/sync-status.tsx. Both of these
      // feed that one decision, which is the only thing on the app's critical path that
      // spends money at the broker.
      autoSyncOnLogin: false,
      lastLoginAt: null,
    });
    expect(session?.ctx).toMatchObject({ tenantId: TENANT.id, userId: 'user-1' });
  });

  // The lookup is scoped by the tenant of the *request*, not by anything in the cookie, so
  // a cookie lifted from one client's domain finds nothing on another's.
  it('scopes the lookup by the host tenant, not the cookie', async () => {
    signIn();
    resolveTenant.mockResolvedValue({
      state: 'active',
      tenant: { id: 'tenant-bob', name: 'Bob', domain: 'bob.itest' },
    });
    findSession.mockResolvedValue(null);

    expect(await getSession()).toBeNull();
    expect(findSession).toHaveBeenCalledWith(expect.any(String), 'tenant-bob');
  });

  it('refuses every cookie on a suspended tenant, without querying', async () => {
    signIn();
    resolveTenant.mockResolvedValue({ state: 'suspended', tenant: TENANT });

    expect(await getSession()).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('refuses every cookie on an unknown host', async () => {
    signIn();
    resolveTenant.mockResolvedValue({ state: 'unknown' });

    expect(await getSession()).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  // The HMAC exists so junk cookies cost a hash instead of a query; if the check ever moved
  // after the lookup, a flood of forged cookies would become a flood of queries.
  it('rejects a forged cookie before it reaches the database', async () => {
    cookieJar.set(SESSION_COOKIE, { value: 'a-random-token.forged-signature' });

    expect(await getSession()).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('returns null when there is no cookie at all', async () => {
    expect(await getSession()).toBeNull();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('returns null when the token is signed but unknown', async () => {
    signIn();
    findSession.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
  });
});

describe('the idle window', () => {
  it('is an hour, which is the whole point of it', () => {
    // Named rather than inferred. It was thirty days, and the figure is the feature: a laptop
    // left open in a café stayed signed in for a month.
    expect(SESSION_IDLE_TTL_MS).toBe(60 * 60 * 1000);
    // Short enough to matter, and rewritten often enough that the hour is accurate to within
    // the refresh interval rather than to within a day.
    expect(SESSION_REFRESH_AFTER_MS).toBeLessThan(SESSION_IDLE_TTL_MS / 4);
  });

  it('does not write on a session that was refreshed a moment ago', async () => {
    signIn();
    findSession.mockResolvedValue(
      record({
        expiresAt: new Date(Date.now() + SESSION_IDLE_TTL_MS - SESSION_REFRESH_AFTER_MS + 5_000),
      }),
    );

    await getSession();
    expect(touchSession).not.toHaveBeenCalled();
  });

  it('pushes the window out again on a session that is still being used', async () => {
    signIn();
    findSession.mockResolvedValue(
      record({
        expiresAt: new Date(Date.now() + SESSION_IDLE_TTL_MS - SESSION_REFRESH_AFTER_MS - 5_000),
      }),
    );

    await getSession();
    expect(touchSession).toHaveBeenCalledTimes(1);

    const [sessionId, expiresAt] = touchSession.mock.calls[0] as [string, Date];
    expect(sessionId).toBe('sess-1');
    // A full hour again, not the remainder — somebody working is never signed out mid-session.
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_IDLE_TTL_MS - 5_000);
  });
});

describe('requireSession', () => {
  it('redirects to the login page instead of returning null', async () => {
    await expect(requireSession()).rejects.toThrow(RedirectError);
    await expect(requireSession()).rejects.toMatchObject({ to: '/login' });
  });

  it('returns the session when there is one', async () => {
    signIn();
    await expect(requireSession()).resolves.toMatchObject({ tenant: TENANT });
  });
});

describe('startSession', () => {
  it('stores only the hash of the token it puts in the cookie', async () => {
    await startSession('user-1');

    const cookie = cookieJar.get(SESSION_COOKIE);
    const token = unpackCookie(cookie?.value);
    expect(token).toBeTruthy();

    const [args] = createSession.mock.calls[0] as [{ tokenHash: string; expiresAt: Date }];
    expect(args.tokenHash).toBe(hashToken(token as string));
    // The raw token must appear nowhere in what is written to the database.
    expect(JSON.stringify(createSession.mock.calls[0])).not.toContain(token as string);
    expect(args.expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_IDLE_TTL_MS - 5_000);
  });

  it('sets the cookie httpOnly, SameSite=Lax and path-wide', async () => {
    await startSession('user-1');

    expect(cookieJar.get(SESSION_COOKIE)?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // The cookie deliberately outlives the session row. Expiry is enforced in the database
      // so it can roll on activity; a cookie cannot, because it can only be written from a
      // server action, never from the layout that reads the session. A cookie that outlives
      // its row authenticates nothing — findSession filters on expiresAt.
      maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
    });
    expect(SESSION_COOKIE_MAX_AGE_MS).toBeGreaterThan(SESSION_IDLE_TTL_MS);
  });

  it('records the first forwarded hop as the client address', async () => {
    requestHeaders.set('x-forwarded-for', '203.0.113.7, 10.0.0.1');
    requestHeaders.set('user-agent', 'u'.repeat(500));
    await startSession('user-1');

    const [args] = createSession.mock.calls[0] as [{ ip: string; userAgent: string }];
    expect(args.ip).toBe('203.0.113.7');
    // Bounded so a hostile header cannot write an unbounded row.
    expect(args.userAgent).toHaveLength(300);
  });

  it('leaves ip and user agent null when the headers are absent', async () => {
    await startSession('user-1');
    const [args] = createSession.mock.calls[0] as [{ ip: unknown; userAgent: unknown }];
    expect(args.ip).toBeNull();
    expect(args.userAgent).toBeNull();
  });
});

describe('endSession', () => {
  it('deletes the stored session and expires the cookie', async () => {
    const token = signIn();
    await endSession();

    expect(deleteSession).toHaveBeenCalledWith(hashToken(token));
    expect(cookieJar.get(SESSION_COOKIE)).toMatchObject({ value: '', options: { maxAge: 0 } });
  });

  it('still clears the cookie when the cookie was forged', async () => {
    cookieJar.set(SESSION_COOKIE, { value: 'nonsense' });
    await endSession();

    expect(deleteSession).not.toHaveBeenCalled();
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBe('');
  });
});
