import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '@/lib/crypto/tokens';
import { consumeResetToken, createResetToken, findValidResetToken } from '@/lib/db/unscoped';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The password-reset token lifecycle.
 *
 * A reset link is a bearer credential that arrives by email, so every one of its limits is
 * load-bearing: it must expire, work once, be replaced when a new one is requested, and be
 * meaningless on another client's domain. None of those are visible from the UI — a broken
 * one looks exactly like a working one until someone replays an old link.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

const MINUTE = 60_000;
/** The TTL the reset action uses (src/app/(auth)/actions.ts). */
const RESET_TTL_MS = 30 * MINUTE;

async function issue(fixture: Fixture, expiresInMs = RESET_TTL_MS): Promise<string> {
  const token = generateToken();
  await createResetToken({
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

describe('findValidResetToken', () => {
  it('resolves a live token to its user and tenant', async () => {
    const token = await issue(alice);
    expect(await findValidResetToken(hashToken(token), alice.tenantId)).toMatchObject({
      userId: alice.userId,
      tenantId: alice.tenantId,
    });
  });

  it('does not resolve an unknown token', async () => {
    expect(await findValidResetToken(hashToken(generateToken()), alice.tenantId)).toBeNull();
  });

  // Only the hash is stored, so the token from the emailed link is not itself a key: a leak
  // of this table hands out nothing that can be pasted into a reset URL.
  it('stores the hash and not the token', async () => {
    const token = await issue(alice);
    const row = await testDb.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
    });

    expect(row.tokenHash).not.toBe(token);
    expect(await findValidResetToken(token, alice.tenantId)).toBeNull();
  });

  describe('TTL', () => {
    it('refuses a token past its expiry', async () => {
      const token = await issue(alice, -MINUTE);
      expect(await findValidResetToken(hashToken(token), alice.tenantId)).toBeNull();
    });

    it('still accepts one a minute short of the 30-minute window', async () => {
      const token = await issue(alice, RESET_TTL_MS - MINUTE);
      expect(await findValidResetToken(hashToken(token), alice.tenantId)).not.toBeNull();
    });

    it('treats the expiry instant itself as expired', async () => {
      const token = await issue(alice, 0);
      expect(await findValidResetToken(hashToken(token), alice.tenantId)).toBeNull();
    });
  });

  describe('single use', () => {
    it('refuses a token that has already been consumed', async () => {
      const token = await issue(alice);
      const found = await findValidResetToken(hashToken(token), alice.tenantId);

      await consumeResetToken(found!.id);

      expect(await findValidResetToken(hashToken(token), alice.tenantId)).toBeNull();
    });

    it('records when it was used rather than deleting the row', async () => {
      const token = await issue(alice);
      const found = await findValidResetToken(hashToken(token), alice.tenantId);
      await consumeResetToken(found!.id);

      const row = await testDb.passwordResetToken.findUniqueOrThrow({ where: { id: found!.id } });
      expect(row.usedAt).toBeInstanceOf(Date);
    });
  });

  describe('one live token per user', () => {
    it('invalidates the previous link when a new one is requested', async () => {
      const first = await issue(alice);
      const second = await issue(alice);

      expect(await findValidResetToken(hashToken(first), alice.tenantId)).toBeNull();
      expect(await findValidResetToken(hashToken(second), alice.tenantId)).not.toBeNull();
    });

    // The sweep is filtered by user id; a reset requested on one client's domain must not
    // cancel a reset another client is in the middle of.
    it("leaves another user's live token alone", async () => {
      const bobToken = await issue(bob);
      await issue(alice);

      expect(await findValidResetToken(hashToken(bobToken), bob.tenantId)).not.toBeNull();
    });

    it('keeps the audit trail of tokens that were already used', async () => {
      const used = await issue(alice);
      const found = await findValidResetToken(hashToken(used), alice.tenantId);
      await consumeResetToken(found!.id);

      await issue(alice);

      expect(
        await testDb.passwordResetToken.findUnique({ where: { id: found!.id } }),
      ).not.toBeNull();
    });
  });

  // Same reasoning as sessions: the tenant is part of the WHERE clause, so a link mailed
  // for one client's domain resolves to nothing when it is opened on another's — even
  // though the token itself is genuine and unused.
  it("does not resolve through another tenant's domain", async () => {
    const token = await issue(alice);
    expect(await findValidResetToken(hashToken(token), bob.tenantId)).toBeNull();
    // …and is still valid on its own.
    expect(await findValidResetToken(hashToken(token), alice.tenantId)).not.toBeNull();
  });
});
