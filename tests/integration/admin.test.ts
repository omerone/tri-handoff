import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLongPosition,
  connectMt5Account,
  createFinanceEntry,
} from '@/lib/db';
import {
  deleteTenant,
  getTenantDetail,
  platformStats,
  syncHealth,
  tenantSyncLogs,
  updateTenant,
} from '@/lib/db/unscoped';
import { encryptSecret } from '@/lib/crypto/secretbox';
import { syncMt5 } from '@/lib/mt5/sync';
import { cleanup, createTenantFixture, reserveDomain, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The operator panel is the one place in the product that reads across tenants on purpose,
 * so the tests here are about it reading the *right* things: whose data is whose, and
 * whether the health ordering actually surfaces a broken client.
 */

let healthy: Fixture;
let broken: Fixture;
let neverConnected: Fixture;
let suspended: Fixture;

beforeAll(async () => {
  healthy = await createTenantFixture();
  broken = await createTenantFixture();
  neverConnected = await createTenantFixture();
  suspended = await createTenantFixture({ status: 'suspended' });

  await connectMt5Account(healthy.ctx, {
    login: '50214437',
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret('read-only'),
    accountCurrency: 'USD',
  });
  await syncMt5(healthy.ctx, 'backfill');

  await createFinanceEntry(healthy.ctx, {
    type: 'income',
    category: 'salary',
    label: 'Salary',
    amountIls: 18_500,
    entryDate: new Date(Date.UTC(2026, 6, 1)),
    isRecurring: false,
  });
  await createLongPosition(healthy.ctx, {
    symbol: 'AAPL',
    qty: 10,
    buyPrice: 180,
    buyDate: new Date(Date.UTC(2026, 0, 10)),
    fees: 0,
    currency: 'USD',
  });

  // A client whose last sync failed.
  await connectMt5Account(broken.ctx, {
    login: '99998888',
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret('read-only'),
    accountCurrency: 'USD',
  });
  await testDb.syncLog.create({
    data: {
      userId: broken.userId,
      status: 'error',
      trigger: 'login',
      error: 'Broker unreachable',
      finishedAt: new Date(),
    },
  });
});

afterAll(cleanup);

describe('tenant detail', () => {
  it('reports the counts that belong to that client', async () => {
    const detail = await getTenantDetail(healthy.tenantId);

    expect(detail?.counts.financeEntries).toBe(1);
    expect(detail?.counts.longPositions).toBe(1);
    expect(detail?.counts.trades).toBeGreaterThan(90);
    expect(detail?.user?.email).toBe(healthy.email);
  });

  it("does not attribute one client's data to another", async () => {
    const other = await getTenantDetail(neverConnected.tenantId);
    expect(other?.counts).toEqual({ trades: 0, financeEntries: 0, longPositions: 0 });
    expect(other?.mt5).toBeNull();
  });

  it('never exposes the stored investor password', async () => {
    // The operator has no business holding a client's broker credentials, and the detail
    // view is the obvious place for one to leak into.
    const detail = await getTenantDetail(healthy.tenantId);
    expect(JSON.stringify(detail)).not.toContain('investorPwEncrypted');
    expect(JSON.stringify(detail)).not.toContain('read-only');
  });

  it('returns null for a tenant that does not exist', async () => {
    expect(await getTenantDetail('no-such-tenant')).toBeNull();
  });
});

describe('sync health', () => {
  it('puts a failing client above a healthy one', async () => {
    const rows = await syncHealth();
    const index = (id: string) => rows.findIndex((row) => row.tenantId === id);

    expect(index(broken.tenantId)).toBeGreaterThanOrEqual(0);
    expect(index(broken.tenantId)).toBeLessThan(index(healthy.tenantId));
  });

  it('puts a client who never connected above a healthy one', async () => {
    const rows = await syncHealth();
    const index = (id: string) => rows.findIndex((row) => row.tenantId === id);
    expect(index(neverConnected.tenantId)).toBeLessThan(index(healthy.tenantId));
  });

  it('does not treat a suspended client as broken', async () => {
    // Suspended is a decision, not a fault, and ranking it as urgent would bury real
    // failures underneath it.
    const rows = await syncHealth();
    const index = (id: string) => rows.findIndex((row) => row.tenantId === id);
    expect(index(suspended.tenantId)).toBeGreaterThan(index(broken.tenantId));
  });

  it('carries the last error so the operator does not have to open the client', async () => {
    const rows = await syncHealth();
    const row = rows.find((r) => r.tenantId === broken.tenantId)!;
    expect(row.lastSyncStatus).toBe('error');
    expect(row.lastError).toContain('Broker unreachable');
  });

  it('counts failures per client, not globally', async () => {
    const rows = await syncHealth();
    expect(rows.find((r) => r.tenantId === broken.tenantId)!.failuresLast24h).toBe(1);
    expect(rows.find((r) => r.tenantId === healthy.tenantId)!.failuresLast24h).toBe(0);
  });
});

describe('platform stats', () => {
  it('counts clients, active clients, connections and failures', async () => {
    // Derived from rows the caller already has, rather than re-running the cross-tenant
    // query the operator page has just run.
    const stats = platformStats(await syncHealth());
    expect(stats.tenants).toBeGreaterThanOrEqual(4);
    expect(stats.connected).toBeGreaterThanOrEqual(2);
    expect(stats.failing).toBeGreaterThanOrEqual(1);
    expect(stats.active).toBeLessThan(stats.tenants); // The suspended one.
  });
});

describe('sync logs', () => {
  it("returns only that client's runs, newest first", async () => {
    const logs = await tenantSyncLogs(healthy.tenantId);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((log) => log.status !== 'error')).toBe(true);

    const brokenLogs = await tenantSyncLogs(broken.tenantId);
    expect(brokenLogs).toHaveLength(1);
    expect(brokenLogs[0]!.error).toContain('Broker unreachable');
  });
});

describe('updating a tenant', () => {
  it('renames and rebinds the domain', async () => {
    const domain = reserveDomain();
    expect(await updateTenant(neverConnected.tenantId, { name: 'Renamed', domain })).toEqual({
      ok: true,
    });

    const detail = await getTenantDetail(neverConnected.tenantId);
    expect(detail?.name).toBe('Renamed');
    expect(detail?.domain).toBe(domain);
  });

  it('normalises the domain before storing it', async () => {
    const domain = reserveDomain();
    await updateTenant(neverConnected.tenantId, { domain: `${domain.toUpperCase()}:8443` });
    expect((await getTenantDetail(neverConnected.tenantId))?.domain).toBe(domain);
  });

  it('refuses a domain another client already holds', async () => {
    // Two tenants on one host would make the request-time lookup ambiguous.
    const result = await updateTenant(neverConnected.tenantId, { domain: healthy.domain });
    expect(result).toEqual({ ok: false, reason: 'domain-taken' });
  });

  it('allows a tenant to keep its own domain', async () => {
    const current = (await getTenantDetail(neverConnected.tenantId))!.domain;
    expect(await updateTenant(neverConnected.tenantId, { domain: current })).toEqual({ ok: true });
  });

  it('refuses an invalid hostname', async () => {
    expect(await updateTenant(neverConnected.tenantId, { domain: 'not a domain' })).toEqual({
      ok: false,
      reason: 'invalid-domain',
    });
  });

  it('reports a tenant that no longer exists', async () => {
    expect(await updateTenant('gone', { name: 'x' })).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('deleting a tenant', () => {
  it('removes the client and everything hanging off them', async () => {
    const doomed = await createTenantFixture();
    await createFinanceEntry(doomed.ctx, {
      type: 'expense',
      category: 'rent',
      label: 'Rent',
      amountIls: 6_200,
      entryDate: new Date(Date.UTC(2026, 6, 2)),
      isRecurring: false,
    });

    expect(await deleteTenant(doomed.tenantId)).toBe(true);

    expect(await getTenantDetail(doomed.tenantId)).toBeNull();
    // The cascade is what makes deletion honest — leaving orphaned finance rows behind
    // would mean "deleted" did not mean deleted.
    expect(await testDb.financeEntry.count({ where: { userId: doomed.userId } })).toBe(0);
    expect(await testDb.user.count({ where: { id: doomed.userId } })).toBe(0);
  });

  it('reports false for a tenant that is already gone', async () => {
    expect(await deleteTenant('no-such-tenant')).toBe(false);
  });
});
