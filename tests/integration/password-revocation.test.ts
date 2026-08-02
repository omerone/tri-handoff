import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '@/lib/crypto/tokens';
import { createSession, findSession, setPasswordHash } from '@/lib/db/unscoped';
import { cleanup, createTenantFixture, type Fixture } from '../helpers/fixtures';

/**
 * Changing a password must end every session that was open under the old one.
 *
 * The self-service reset always did this — `redeemResetToken` does it in a transaction. The
 * operator's "set a client's password" path called `setPasswordHash` directly and did not,
 * so an operator using the feature for exactly the reason it exists ("the client can't
 * receive their reset email" — which is also what a compromised account looks like) would
 * believe they had locked an attacker out while the attacker's cookie kept working, refreshed
 * on every request for another thirty days.
 *
 * The revocation now lives inside `setPasswordHash` rather than in its callers, because a
 * caller cannot forget something it does not have to remember. This test guards that.
 */

let alice: Fixture;
let bob: Fixture;

async function openSession(fixture: Fixture, token: string) {
  await createSession({
    userId: fixture.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('setPasswordHash', () => {
  it('ends every session the user had open', async () => {
    await openSession(alice, 'laptop-token');
    await openSession(alice, 'phone-token');

    expect(await findSession(hashToken('laptop-token'), alice.tenantId)).not.toBeNull();
    expect(await findSession(hashToken('phone-token'), alice.tenantId)).not.toBeNull();

    await setPasswordHash(alice.userId, 'a-new-hash');

    // Both devices, not just the one that changed the password.
    expect(await findSession(hashToken('laptop-token'), alice.tenantId)).toBeNull();
    expect(await findSession(hashToken('phone-token'), alice.tenantId)).toBeNull();
  });

  it('actually changes the password', async () => {
    await setPasswordHash(alice.userId, 'another-hash');
    const { testDb } = await import('../helpers/fixtures');
    const user = await testDb.user.findUniqueOrThrow({ where: { id: alice.userId } });
    expect(user.passwordHash).toBe('another-hash');
  });

  it('leaves other users signed in', async () => {
    await openSession(bob, 'bob-token');
    await setPasswordHash(alice.userId, 'yet-another-hash');

    // Revoking one client's sessions must not sign out every other client on the platform.
    expect(await findSession(hashToken('bob-token'), bob.tenantId)).not.toBeNull();
  });
});
