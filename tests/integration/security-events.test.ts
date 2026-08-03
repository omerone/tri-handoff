import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countAdminActionsByAdmin,
  countAuthEventsByUser,
  countRecentAuthEvents,
  findPasswordHash,
  findUserEmails,
  listLargeExports,
  recordAdminAction,
  recordAuthEvent,
  recordDataAccess,
} from '@/lib/db/security-events';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The security-events repository.
 *
 * These tables are the record of who did what, and they are the one family in the product
 * that is deliberately not tenant-scoped — so nothing else in the codebase constrains them.
 * A miscounted threshold means an alert that never fires, and an alert that never fires is
 * indistinguishable from nothing happening.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

const MINUTE = 60_000;
const context = { ipAddress: '198.51.100.4', userAgent: 'itest' };

/**
 * Unique per run. An operator id is a free string with no tenant behind it, so the fixture
 * cleanup cannot reach these rows — a fixed id counted every previous run's writes too, and
 * the count assertion below climbed by one each time the suite was executed.
 */
const adminId = `admin-itest-${randomBytes(4).toString('hex')}`;

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(async () => {
  await testDb.adminAuditLog.deleteMany({ where: { adminId } });
  await cleanup();
  await testDb.$disconnect();
});

describe('auth events', () => {
  it('records an event with the address it came from', async () => {
    await recordAuthEvent({
      userId: alice.userId,
      eventType: 'login_success',
      description: 'signed in',
      result: 'success',
      context,
    });

    const row = await testDb.authEvent.findFirst({
      where: { userId: alice.userId, eventType: 'login_success' },
    });
    expect(row?.ipAddress).toBe('198.51.100.4');
    expect(row?.userAgent).toBe('itest');
    expect(row?.result).toBe('success');
  });

  it('keeps the failure reason as queryable JSON, not a string', async () => {
    await recordAuthEvent({
      userId: alice.userId,
      eventType: 'login_failed',
      description: 'wrong password',
      result: 'failure',
      details: { failureReason: 'wrong_password' },
      context,
    });

    const row = await testDb.authEvent.findFirst({
      where: { userId: alice.userId, eventType: 'login_failed' },
    });
    // An object, so `details->>'failureReason'` works. Stringifying it would store a quoted
    // blob that no query can reach into — the bug this asserts against.
    expect(row?.details).toEqual({ failureReason: 'wrong_password' });
  });

  it('counts only events inside the window', async () => {
    const since = new Date(Date.now() - 30 * MINUTE);
    const count = await countRecentAuthEvents({
      userId: alice.userId,
      eventType: 'login_failed',
      since,
    });
    expect(count).toBe(1);

    // A window that closed before the event was written must not see it.
    const future = await countRecentAuthEvents({
      userId: alice.userId,
      eventType: 'login_failed',
      since: new Date(Date.now() + MINUTE),
    });
    expect(future).toBe(0);
  });

  it('groups by user, and does not mix two users together', async () => {
    await recordAuthEvent({
      userId: bob.userId,
      eventType: 'login_failed',
      description: 'wrong password',
      result: 'failure',
      context,
    });
    await recordAuthEvent({
      userId: bob.userId,
      eventType: 'login_failed',
      description: 'wrong password',
      result: 'failure',
      context,
    });

    const grouped = await countAuthEventsByUser({
      eventType: 'login_failed',
      result: 'failure',
      since: new Date(Date.now() - 30 * MINUTE),
    });

    expect(grouped.find((row) => row.userId === alice.userId)?.count).toBe(1);
    expect(grouped.find((row) => row.userId === bob.userId)?.count).toBe(2);
  });
});

describe('data access', () => {
  it('records an export with its size, and finds the large ones', async () => {
    await recordDataAccess({
      userId: alice.userId,
      action: 'export',
      resource: 'trades',
      recordCount: 5_000,
      dataSizeBytes: 1_234,
      ipAddress: context.ipAddress,
    });
    // Below the threshold the sweep looks for, so it must not be reported.
    await recordDataAccess({
      userId: bob.userId,
      action: 'export',
      resource: 'trades',
      recordCount: 3,
      ipAddress: context.ipAddress,
    });

    const large = await listLargeExports({
      since: new Date(Date.now() - 30 * MINUTE),
      minRecords: 1_000,
    });

    const ids = large.map((row) => row.userId);
    expect(ids).toContain(alice.userId);
    expect(ids).not.toContain(bob.userId);
  });
});

describe('admin actions', () => {
  it('stores field-level changes as JSON', async () => {
    await recordAdminAction({
      adminId,
      tenantId: alice.tenantId,
      actionType: 'suspend_tenant',
      description: 'suspended',
      changes: { status: { from: 'active', to: 'suspended' } },
      context,
    });

    const row = await testDb.adminAuditLog.findFirst({ where: { adminId } });
    expect(row?.changes).toEqual({ status: { from: 'active', to: 'suspended' } });
  });

  it('counts actions per operator', async () => {
    const grouped = await countAdminActionsByAdmin({ since: new Date(Date.now() - 30 * MINUTE) });
    expect(grouped.find((row) => row.adminId === adminId)?.count).toBe(1);
  });
});

describe('user lookups', () => {
  it('resolves many addresses in one call, and tolerates an empty list', async () => {
    const emails = await findUserEmails([alice.userId, bob.userId, alice.userId]);
    expect(emails.get(alice.userId)).toBe(alice.email);
    expect(emails.get(bob.userId)).toBe(bob.email);
    expect(emails.size).toBe(2);

    expect((await findUserEmails([])).size).toBe(0);
  });

  it('returns the password hash for re-authentication, and null for a stranger', async () => {
    // Compared against the stored column rather than an argon2 shape: the point of this
    // function is that it returns the hash unchanged, and fixtures store a placeholder.
    const stored = await testDb.user.findUnique({
      where: { id: alice.userId },
      select: { passwordHash: true },
    });
    expect(await findPasswordHash(alice.userId)).toBe(stored?.passwordHash);

    expect(await findPasswordHash('no-such-user')).toBeNull();
  });
});
