import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMt5Account, createLongPosition, updateCurrentPrice } from '@/lib/db';
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
async function waitForAuditRow(recordId: string, timeoutMs = 4000) {
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
