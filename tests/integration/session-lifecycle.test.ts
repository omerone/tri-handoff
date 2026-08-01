import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '@/lib/crypto/tokens';
import { pruneExpiredSessions } from '@/lib/db';
import {
  createSession,
  deleteSession,
  deleteUserSessions,
  findSession,
  touchSession,
} from '@/lib/db/unscoped';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * Session storage, against the real database.
 *
 * `findSession` is the query that turns a cookie into an identity, and the tenant id is
 * part of its WHERE clause rather than a check afterwards — so a session issued on one
 * client's domain is invisible on another's. That is the property under test here; the
 * cookie-level half (signature, suspended tenants, rolling refresh) is in
 * src/lib/auth/session.test.ts.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

const MINUTE = 60_000;

let counter = 0;
/** Creates a session through the repository and returns the raw token it is keyed by. */
async function openSession(fixture: Fixture, expiresInMs = 30 * MINUTE): Promise<string> {
  const token = `itest-token-${fixture.userId}-${counter++}`;
  await createSession({
    userId: fixture.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + expiresInMs),
  });
  return token;
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('findSession', () => {
  it('returns the session with its user and tenant in one lookup', async () => {
    const token = await openSession(alice);
    const found = await findSession(hashToken(token), alice.tenantId);

    expect(found).toMatchObject({
      userId: alice.userId,
      tenantId: alice.tenantId,
      email: alice.email,
      locale: 'he',
      displayCurrency: 'ILS',
      tenantDomain: alice.domain,
      tenantStatus: 'active',
    });
  });

  // The attack this scopes against: a cookie lifted from one client's domain, replayed on
  // another's. Both tenants live in the same table, so only the tenant predicate stops it.
  it("does not resolve a session through another tenant's domain", async () => {
    const token = await openSession(alice);
    expect(await findSession(hashToken(token), bob.tenantId)).toBeNull();
  });

  it('does not resolve an unknown token', async () => {
    expect(await findSession(hashToken('never-issued'), alice.tenantId)).toBeNull();
  });

  // What lands in `token_hash` is the digest, never the cookie value — so a dump of this
  // table is not a set of usable cookies.
  it('stores the hash and not the token', async () => {
    const token = await openSession(alice);
    const row = await testDb.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });

    expect(row.tokenHash).not.toBe(token);
    expect(await findSession(token, alice.tenantId)).toBeNull();
  });

  it('does not resolve an expired session', async () => {
    const token = await openSession(alice, -MINUTE);
    expect(await findSession(hashToken(token), alice.tenantId)).toBeNull();
  });

  it('treats expiry as strictly in the future', async () => {
    const token = await openSession(alice, 0);
    expect(await findSession(hashToken(token), alice.tenantId)).toBeNull();
  });

  // Suspension is enforced one layer up, in getSession, which resolves the tenant first and
  // never asks. This asserts the split rather than the gate: the record still comes back,
  // carrying the status that the caller is expected to act on.
  it('reports a suspended tenant rather than hiding the session', async () => {
    const suspended = await createTenantFixture({ status: 'suspended' });
    const token = await openSession(suspended);

    expect(await findSession(hashToken(token), suspended.tenantId)).toMatchObject({
      tenantStatus: 'suspended',
    });
  });
});

describe('touchSession', () => {
  it('extends the expiry and revives a session that was about to lapse', async () => {
    const token = await openSession(alice, MINUTE);
    const before = await findSession(hashToken(token), alice.tenantId);
    expect(before).not.toBeNull();

    const extended = new Date(Date.now() + 30 * MINUTE);
    await touchSession(before!.sessionId, extended);

    const after = await findSession(hashToken(token), alice.tenantId);
    expect(after!.expiresAt.getTime()).toBe(extended.getTime());
  });

  it('advances lastSeenAt, which is what an idle-session audit reads', async () => {
    const token = await openSession(alice);
    const row = await testDb.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await touchSession(row.id, new Date(Date.now() + 30 * MINUTE));

    const updated = await testDb.session.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.lastSeenAt.getTime()).toBeGreaterThan(row.lastSeenAt.getTime());
  });
});

describe('deleteSession', () => {
  it('signs out exactly the one device', async () => {
    const first = await openSession(alice);
    const second = await openSession(alice);

    await deleteSession(hashToken(first));

    expect(await findSession(hashToken(first), alice.tenantId)).toBeNull();
    expect(await findSession(hashToken(second), alice.tenantId)).not.toBeNull();
  });

  it('is a no-op for a token that was already deleted', async () => {
    await expect(deleteSession(hashToken('never-issued'))).resolves.toBeUndefined();
  });
});

describe('deleteUserSessions', () => {
  /**
   * Called after a password reset. If it ever stopped removing *every* session, a stolen
   * cookie would survive the reset the user performed precisely to revoke it — and the user
   * would have no way to tell.
   */
  it('revokes every session of the user and nobody else’s', async () => {
    const aliceTokens = [await openSession(alice), await openSession(alice)];
    const bobToken = await openSession(bob);

    await deleteUserSessions(alice.userId);

    for (const token of aliceTokens) {
      expect(await findSession(hashToken(token), alice.tenantId)).toBeNull();
    }
    expect(await findSession(hashToken(bobToken), bob.tenantId)).not.toBeNull();
  });
});

describe('pruneExpiredSessions', () => {
  it('removes lapsed sessions and keeps live ones', async () => {
    const stale = await openSession(bob, -MINUTE);
    const live = await openSession(bob, 30 * MINUTE);

    await pruneExpiredSessions();

    // Asserted per row, not by the returned count: the sweep is global and other rows in
    // the development database may legitimately expire at the same moment.
    expect(await testDb.session.findUnique({ where: { tokenHash: hashToken(stale) } })).toBeNull();
    expect(
      await testDb.session.findUnique({ where: { tokenHash: hashToken(live) } }),
    ).not.toBeNull();
  });
});
