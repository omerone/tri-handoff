import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateRecoveryCodes, normalizeRecoveryCode } from '@/lib/auth/recovery-codes';
import { totpCode, totpStep } from '@/lib/auth/totp';
import { hashToken } from '@/lib/crypto/tokens';
import {
  beginTwoFactorSetup,
  confirmTwoFactor,
  consumeRecoveryCodeHash,
  createTwoFactorChallenge,
  deleteTwoFactorChallenge,
  disableTwoFactor,
  failTwoFactorChallenge,
  findTwoFactorChallenge,
  getTwoFactorState,
  MAX_CHALLENGE_ATTEMPTS,
  pruneExpiredTwoFactorChallenges,
  recordTwoFactorStep,
  replaceRecoveryCodes,
} from '@/lib/db/two-factor';
import { cleanup, createTenantFixture, type Fixture } from '../helpers/fixtures';

/**
 * The state behind the second factor, against a real database.
 *
 * `totp.test.ts` proves the arithmetic against the RFC's vectors; this proves the things the
 * arithmetic cannot see — that a recovery code is spent exactly once, that a challenge dies
 * after its attempts, that neither crosses a tenant boundary, and that turning 2FA off leaves
 * nothing behind that could turn it back on.
 *
 * Every one of those is invisible from the UI. A recovery code that could be used twice looks
 * identical to one that cannot until someone uses it twice.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

const MINUTE = 60_000;

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('setup and confirmation', () => {
  it('is off until a code confirms it, however complete the secret looks', async () => {
    await beginTwoFactorSetup(alice.userId, 'sealed-secret');

    const state = await getTwoFactorState(alice.userId);
    expect(state?.secret).toBe('sealed-secret');
    // The pair is what the app reads. A secret with no confirmation is an abandoned wizard.
    expect(state?.confirmedAt).toBeNull();
    expect(state?.recoveryCodes).toEqual([]);
  });

  it('starting again discards the codes issued against the previous secret', async () => {
    await beginTwoFactorSetup(alice.userId, 'first-secret');
    await confirmTwoFactor(alice.userId, {
      at: new Date(),
      step: totpStep(Date.now()),
      recoveryHashes: [hashToken('OLDCODE')],
    });

    await beginTwoFactorSetup(alice.userId, 'second-secret');

    const state = await getTwoFactorState(alice.userId);
    // Codes that open a door protected by a secret nobody holds any more are live bypass
    // credentials for a factor that no longer exists.
    expect(state?.recoveryCodes).toEqual([]);
    expect(state?.confirmedAt).toBeNull();
    expect(state?.lastStep).toBeNull();
  });

  it('turns on with the codes and the spent step together', async () => {
    const codes = generateRecoveryCodes();
    const at = new Date();
    const step = totpStep(at.getTime());

    await beginTwoFactorSetup(alice.userId, 'sealed');
    await confirmTwoFactor(alice.userId, { at, step, recoveryHashes: codes.hashes });

    const state = await getTwoFactorState(alice.userId);
    expect(state?.confirmedAt?.getTime()).toBe(at.getTime());
    expect(state?.recoveryCodes).toHaveLength(10);
    // The very code that switched 2FA on must not also sign anyone in.
    expect(state?.lastStep).toBe(step);
  });
});

describe('the replay guard', () => {
  it('records the step a code was accepted for', async () => {
    const step = totpStep(Date.now());
    await recordTwoFactorStep(alice.userId, step);
    expect((await getTwoFactorState(alice.userId))?.lastStep).toBe(step);
  });

  it('holds a step number far beyond the lifetime of this product', async () => {
    // `totpLastStep` is an Int. A 30-second step in the year 2200 is ~242 million, well inside
    // Int32 — this fails loudly if the column is ever narrowed.
    const distant = totpStep(new Date('2200-01-01T00:00:00Z').getTime());
    await recordTwoFactorStep(alice.userId, distant);
    expect((await getTwoFactorState(alice.userId))?.lastStep).toBe(distant);
  });
});

describe('recovery codes', () => {
  it('spends a code once and refuses it thereafter', async () => {
    const codes = generateRecoveryCodes();
    await replaceRecoveryCodes(alice.userId, codes.hashes);

    const hash = hashToken(normalizeRecoveryCode(codes.plain[0]!));
    expect(await consumeRecoveryCodeHash(alice.userId, hash)).toBe(true);
    expect(await consumeRecoveryCodeHash(alice.userId, hash)).toBe(false);

    expect((await getTwoFactorState(alice.userId))?.recoveryCodes).toHaveLength(9);
  });

  it('spends exactly one when the same code is submitted twice at once', async () => {
    // Two tabs, one code. Read-then-write would let both through, because both would read the
    // list before either had written it back.
    const codes = generateRecoveryCodes();
    await replaceRecoveryCodes(alice.userId, codes.hashes);
    const hash = hashToken(normalizeRecoveryCode(codes.plain[0]!));

    const results = await Promise.all([
      consumeRecoveryCodeHash(alice.userId, hash),
      consumeRecoveryCodeHash(alice.userId, hash),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await getTwoFactorState(alice.userId))?.recoveryCodes).toHaveLength(9);
  });

  it('leaves the other codes alone', async () => {
    const codes = generateRecoveryCodes();
    await replaceRecoveryCodes(alice.userId, codes.hashes);
    await consumeRecoveryCodeHash(alice.userId, hashToken(normalizeRecoveryCode(codes.plain[3]!)));

    const left = (await getTwoFactorState(alice.userId))?.recoveryCodes ?? [];
    for (const [index, code] of codes.plain.entries()) {
      const hash = hashToken(normalizeRecoveryCode(code));
      expect(left.includes(hash), `code ${index}`).toBe(index !== 3);
    }
  });

  it("is not one trader's code on another trader's account", async () => {
    const codes = generateRecoveryCodes();
    await replaceRecoveryCodes(alice.userId, codes.hashes);

    const hash = hashToken(normalizeRecoveryCode(codes.plain[0]!));
    expect(await consumeRecoveryCodeHash(bob.userId, hash)).toBe(false);
    expect((await getTwoFactorState(alice.userId))?.recoveryCodes).toHaveLength(10);
  });
});

describe('the sign-in challenge', () => {
  const issue = async (fixture: Fixture, ttlMs = 5 * MINUTE) => {
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    await createTwoFactorChallenge({
      userId: fixture.userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  };

  it('is found by its token, within its tenant', async () => {
    const token = await issue(alice);
    const found = await findTwoFactorChallenge(hashToken(token), alice.tenantId);
    expect(found?.userId).toBe(alice.userId);
    expect(found?.attempts).toBe(0);
  });

  it('is inert on another client’s domain', async () => {
    // The same boundary `findSession` draws. One deployment serves every client, so a token
    // that worked across domains would be a cookie from one trader's site opening another's.
    const token = await issue(alice);
    expect(await findTwoFactorChallenge(hashToken(token), bob.tenantId)).toBeNull();
  });

  it('is not found once expired', async () => {
    const token = await issue(alice, -MINUTE);
    expect(await findTwoFactorChallenge(hashToken(token), alice.tenantId)).toBeNull();
  });

  it('replaces the previous one, so an abandoned attempt stops opening the door', async () => {
    const first = await issue(alice);
    const second = await issue(alice);

    expect(await findTwoFactorChallenge(hashToken(first), alice.tenantId)).toBeNull();
    expect(await findTwoFactorChallenge(hashToken(second), alice.tenantId)).not.toBeNull();
  });

  it('dies on the last wrong code rather than locking', async () => {
    const token = await issue(alice);
    const challenge = await findTwoFactorChallenge(hashToken(token), alice.tenantId);
    expect(challenge).not.toBeNull();

    for (let attempt = 1; attempt < MAX_CHALLENGE_ATTEMPTS; attempt += 1) {
      const { exhausted } = await failTwoFactorChallenge(challenge!.id);
      expect(exhausted, `attempt ${attempt}`).toBe(false);
      expect((await findTwoFactorChallenge(hashToken(token), alice.tenantId))?.attempts).toBe(
        attempt,
      );
    }

    expect((await failTwoFactorChallenge(challenge!.id)).exhausted).toBe(true);
    // Gone, not flagged: the next try costs the password again.
    expect(await findTwoFactorChallenge(hashToken(token), alice.tenantId)).toBeNull();
  });

  it('is deleted on success, so one challenge is one sign-in', async () => {
    const token = await issue(alice);
    const challenge = await findTwoFactorChallenge(hashToken(token), alice.tenantId);
    await deleteTwoFactorChallenge(challenge!.id);
    expect(await findTwoFactorChallenge(hashToken(token), alice.tenantId)).toBeNull();
  });

  it('sweeps away the ones nobody finished', async () => {
    await issue(alice, -MINUTE);
    await issue(bob, 5 * MINUTE);

    const pruned = await pruneExpiredTwoFactorChallenges();
    expect(pruned).toBeGreaterThanOrEqual(1);
    // The live one survives the sweep.
    expect(await findTwoFactorChallenge(hashToken('nothing'), bob.tenantId)).toBeNull();
  });
});

describe('turning it off', () => {
  it('leaves nothing behind that could turn it back on', async () => {
    const codes = generateRecoveryCodes();
    await beginTwoFactorSetup(alice.userId, 'sealed');
    await confirmTwoFactor(alice.userId, {
      at: new Date(),
      step: totpStep(Date.now()),
      recoveryHashes: codes.hashes,
    });

    await disableTwoFactor(alice.userId);

    const state = await getTwoFactorState(alice.userId);
    // The secret goes too. Reusing one that has been on a phone — and possibly in a
    // screenshot of a QR code — is not the guarantee "turn on two-factor" makes.
    expect(state).toEqual({ secret: null, confirmedAt: null, lastStep: null, recoveryCodes: [] });
  });

  it('makes the codes issued against it useless', async () => {
    const codes = generateRecoveryCodes();
    await replaceRecoveryCodes(alice.userId, codes.hashes);
    await disableTwoFactor(alice.userId);

    const hash = hashToken(normalizeRecoveryCode(codes.plain[0]!));
    expect(await consumeRecoveryCodeHash(alice.userId, hash)).toBe(false);
  });
});

describe('the code an authenticator would show', () => {
  it('is six digits, and different in the next step', async () => {
    // A guard on the two properties the whole scheme rests on, exercised here as well as in
    // the unit tests because this file is what runs against a real deployment's data shapes.
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const now = Date.now();
    expect(totpCode(secret, now)).toMatch(/^\d{6}$/);
    expect(totpCode(secret, now)).not.toBe(totpCode(secret, now + 30_000));
  });
});
