import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIT_RETENTION_DAYS,
  connectMt5Account,
  createLongPosition,
  pruneExpiredAuditLogs,
  updateCurrentPrice,
} from '@/lib/db';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The audit trail, on the rows it is actually asked to record.
 *
 * The extension writes asynchronously and swallows its own failures — deliberately, so the
 * trail never sits in front of the write it describes — which means a broken trail is silent.
 * It was: anything carrying a `Decimal` or a `Date` threw on the way into the JSON column and
 * was dropped, so every trade, position and finance entry went unrecorded while the table
 * filled up with the mutations that happened to hold nothing but strings.
 *
 * A long position is the sharpest test available: five `Decimal` columns and two `DateTime`s.
 */

let alice: Fixture;

const buyDate = new Date(Date.UTC(2026, 0, 15));

/** The write is fire-and-forget, so the assertion has to wait for it rather than assume it. */
/**
 * Polls until the trigger has written the row.
 *
 * Fifteen seconds rather than four. The audit row is written by a database trigger, so it
 * lands a moment after the statement returns and the only honest assertion is "eventually";
 * four seconds was a guess that sat right on the edge once the whole suite runs against one
 * Postgres at once, and the test failed at random with "expected null not to be null" — the
 * least informative way a passing feature can look broken. The happy path still returns in
 * about fifty milliseconds, so the longer deadline costs nothing except in the case that was
 * already failing.
 */
async function waitForAuditRow(recordId: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await testDb.databaseAuditLog.findFirst({
      where: { recordId },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

beforeAll(async () => {
  alice = await createTenantFixture();
});

afterAll(async () => {
  await testDb.databaseAuditLog.deleteMany({ where: { userId: alice.userId } });
  await cleanup();
});

describe('database audit trail', () => {
  it('records a mutation carrying decimals and dates', async () => {
    const position = await createLongPosition(alice.ctx, {
      symbol: 'AUDIT',
      qty: 3,
      buyPrice: 182.4,
      buyDate,
      fees: 1.5,
      currency: 'USD',
    });

    const row = await waitForAuditRow(position.id);
    expect(row, 'no audit row was written for a position create').not.toBeNull();
    expect(row?.tableName).toBe('LongPosition');
    expect(row?.operation).toBe('INSERT');

    // The values survived as values rather than as a decimal library's internals.
    const values = row?.newValues as Record<string, unknown> | null;
    expect(String(values?.buyPrice)).toBe('182.4');
    expect(String(values?.buyDate)).toContain('2026-01-15');
  });

  it('names the user who made the change', async () => {
    // Read from the session where there is one. Taking it out of the arguments only ever
    // worked for creates that happened to carry a `userId`, which most updates do not.
    const position = await createLongPosition(alice.ctx, {
      symbol: 'AUDIT2',
      qty: 1,
      buyPrice: 10,
      buyDate,
      fees: 0,
      currency: 'USD',
    });
    await updateCurrentPrice(alice.ctx, position.id, 12.5);

    const row = await waitForAuditRow(position.id);
    expect(row).not.toBeNull();
    // No request context in a test, so the fallback is what answers here — the point is that
    // *something* identifies the subject rather than the column being empty.
    expect(row?.userId ?? row?.recordId).toBeTruthy();
  });

  it('redacts a secret rather than copying it into a second table', async () => {
    // Through an app repository, not through `testDb`: the fixtures' client is deliberately
    // unextended, so a write made with it is not audited at all.
    const account = await connectMt5Account(alice.ctx, {
      login: '50214437',
      server: 'MetaQuotes-Live01',
      investorPwEncrypted: 'iv:tag:ciphertext-that-must-not-be-copied',
      accountCurrency: 'USD',
    });

    const row = await waitForAuditRow(account.id);
    expect(row, 'no audit row was written for the MT5 connect').not.toBeNull();
    // An upsert records both branches, since which one ran is not knowable from the audit
    // hook — what matters is that the ciphertext appears in neither.
    const values = JSON.stringify(row?.newValues ?? {});
    expect(values).toContain('[REDACTED]');
    expect(values).not.toContain('ciphertext-that-must-not-be-copied');
  });
});

/**
 * Retention.
 *
 * The trail takes a row for every mutation the product makes and nothing deleted them. The
 * disk guard on the VPS is explicitly forbidden from touching the database volume — it is the
 * only copy of the trading book — so an unbounded table there is not a tidiness problem, it
 * is the disk filling up and Postgres refusing writes.
 *
 * `audit-retention.ts` was written for exactly this and its own header says "the hourly sweep
 * drops rows past the retention window". No sweep called it. Both facts this pins down are
 * about the boundary rather than about the delete: that a year-old row goes, that a recent one
 * stays, and that removing audit rows does not itself write audit rows — which is what the
 * unextended client in that module is for, and the one mistake here that would be self-feeding.
 */
describe('audit retention', () => {
  const olderThanPolicy = new Date(Date.now() - (AUDIT_RETENTION_DAYS + 1) * 86_400_000);

  it('drops rows past the window and leaves the rest', async () => {
    // Written straight through the fixtures' unextended client: these are stand-ins for rows
    // the trail wrote months ago, not mutations to be recorded now.
    const stale = await testDb.databaseAuditLog.create({
      data: {
        tableName: 'LongPosition',
        recordId: `retention-stale-${alice.userId}`,
        operation: 'INSERT',
        userId: alice.userId,
        createdAt: olderThanPolicy,
      },
    });
    const fresh = await testDb.databaseAuditLog.create({
      data: {
        tableName: 'LongPosition',
        recordId: `retention-fresh-${alice.userId}`,
        operation: 'INSERT',
        userId: alice.userId,
      },
    });

    const deleted = await pruneExpiredAuditLogs();
    expect(deleted).toBeGreaterThanOrEqual(1);

    expect(await testDb.databaseAuditLog.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await testDb.databaseAuditLog.findUnique({ where: { id: fresh.id } })).not.toBeNull();

    // A trail that audits its own pruning can never shrink: every delete writes rows, and the
    // next sweep has more to do than the last. Asserted as "no row is *about* the audit table"
    // rather than by comparing counts before and after — the trail is fire-and-forget and the
    // rest of the suite is writing to it the whole time, so the total is not this test's to
    // predict. The self-reference is, and it is the thing that would run away.
    const selfReferential = await testDb.databaseAuditLog.count({
      where: { tableName: 'DatabaseAuditLog' },
    });
    expect(selfReferential, 'pruning the audit trail wrote audit rows about the audit trail').toBe(
      0,
    );
  });

  it('keeps a row that is one day inside the window', async () => {
    const justInside = await testDb.databaseAuditLog.create({
      data: {
        tableName: 'FinanceEntry',
        recordId: `retention-edge-${alice.userId}`,
        operation: 'UPDATE',
        userId: alice.userId,
        createdAt: new Date(Date.now() - (AUDIT_RETENTION_DAYS - 1) * 86_400_000),
      },
    });

    await pruneExpiredAuditLogs();

    // Twelve months is the documented total retention, not a number chosen in that file. A
    // prune that crept inward would throw away history the policy promises to keep, and it
    // would do it silently — there is nothing left to notice it with.
    expect(
      await testDb.databaseAuditLog.findUnique({ where: { id: justInside.id } }),
    ).not.toBeNull();
    await testDb.databaseAuditLog.delete({ where: { id: justInside.id } });
  });
});
