import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  getMt5Account,
  latestSyncLog,
  listCashFlow,
  listClosedTrades,
  readCredentialCiphertext,
  recentSyncLogs,
} from '@/lib/db';
import { generateMockDeals } from '@/lib/mt5/mock/generator';
import { syncMt5 } from '@/lib/mt5/sync';
import { sameZonedDay } from '@/lib/time/zone';
import { cleanup, createTenantFixture, crossTenantContext, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The sync runs on every login and again on every press of the refresh button, so the
 * property that matters most is that running it twice changes nothing. A duplicated trade
 * would inflate net P&L and drag win rate toward the duplicated outcome — and nothing in the
 * UI would look wrong, which is what makes it worth a test rather than a code review.
 *
 * Runs against the mock provider (MT5_PROVIDER=mock in tests/setup-env.ts), which is exactly
 * why the mock exists.
 */

const INVESTOR_PASSWORD = 'read-only-secret';

let alice: Fixture;
let bob: Fixture;

async function connect(fixture: Fixture, login = '50214437') {
  await connectMt5Account(fixture.ctx, {
    login,
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret(INVESTOR_PASSWORD),
    accountCurrency: 'USD',
  });
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
  await connect(alice);
});

afterAll(cleanup);

describe('first sync', () => {
  it('backfills the whole history', async () => {
    const result = await syncMt5(alice.ctx, 'backfill');
    expect(result.status).toBe('success');

    const expected = generateMockDeals().deals.filter((deal) => deal.kind === 'trade');
    const trades = await listClosedTrades(alice.ctx);
    expect(trades).toHaveLength(expected.length);
  });

  it('records the run in the sync log', async () => {
    const log = await latestSyncLog(alice.ctx);
    expect(log?.status).toBe('success');
    expect(log?.finishedAt).not.toBeNull();
    expect(log?.tradesImported).toBeGreaterThan(0);
    expect(log?.error).toBeNull();
  });

  it('stores the account state the provider reported', async () => {
    const account = await getMt5Account(alice.ctx);
    expect(account?.accountCurrency).toBe('USD');
    expect(account?.lastSyncAt).not.toBeNull();
    expect(account?.status).toBe('connected');
    expect(account?.balance).toBeGreaterThan(0);
  });

  it('keeps the opening deposit out of the trade stream', async () => {
    const trades = await listClosedTrades(alice.ctx);
    expect(trades.every((trade) => trade.kind === 'trade')).toBe(true);

    // Stored, though — SPEC §3.2 wants the cash flow visible.
    const cashFlow = await listCashFlow(alice.ctx);
    expect(cashFlow).toHaveLength(1);
    expect(cashFlow[0]!.profit).toBe(10_000);
  });
});

describe('repeat sync', () => {
  it('imports nothing new and duplicates nothing', async () => {
    const before = await listClosedTrades(alice.ctx);

    const result = await syncMt5(alice.ctx, 'login');
    expect(result.status).toBe('success');
    expect(result.status === 'success' && result.imported).toBe(0);

    const after = await listClosedTrades(alice.ctx);
    expect(after).toHaveLength(before.length);
    // Same tickets, same P&L — an upsert, not an insert.
    expect(after.map((t) => t.ticket)).toEqual(before.map((t) => t.ticket));
    expect(after.reduce((sum, t) => sum + t.profit, 0)).toBeCloseTo(
      before.reduce((sum, t) => sum + t.profit, 0),
      6,
    );
  });

  it('leaves exactly one row per ticket', async () => {
    const trades = await listClosedTrades(alice.ctx);
    expect(new Set(trades.map((t) => t.ticket)).size).toBe(trades.length);
  });
});

describe('what the sync derives', () => {
  it('stores profit net of commission and swap', async () => {
    const trades = await listClosedTrades(alice.ctx);
    const source = new Map(
      generateMockDeals()
        .deals.filter((deal) => deal.kind === 'trade')
        .map((deal) => [deal.ticket, deal]),
    );

    for (const trade of trades) {
      const deal = source.get(trade.ticket)!;
      expect(trade.profit).toBeCloseTo(deal.profit + deal.commission + deal.swap, 6);
    }
  });

  it('computes risk and RR for every trade that has a stop loss', async () => {
    const trades = await listClosedTrades(alice.ctx);
    expect(trades.every((trade) => trade.stopLoss !== null)).toBe(true);
    expect(trades.every((trade) => trade.risk !== null && trade.rr !== null)).toBe(true);
  });

  it('derives RR as net profit over risk', async () => {
    const trades = await listClosedTrades(alice.ctx);
    for (const trade of trades) {
      expect(trade.rr!).toBeCloseTo(trade.profit / trade.risk!, 6);
    }
  });

  it('classifies gold as a commodity, not forex', async () => {
    const gold = (await listClosedTrades(alice.ctx)).filter((t) => t.symbol === 'XAUUSD');
    expect(gold.length).toBeGreaterThan(0);
    expect(gold.every((t) => t.assetClass === 'commodities')).toBe(true);
  });

  it('calls a trade "day" when it opened and closed on one calendar day', async () => {
    // By the calendar, not by elapsed hours — that is how a trader describes their own book,
    // and it is what keeps a day trade on one square of the calendar.
    const trades = await listClosedTrades(alice.ctx);
    for (const trade of trades) {
      const expected = sameZonedDay(trade.openAt, trade.closeAt!) ? 'day' : 'swing';
      expect(trade.style).toBe(expected);
    }
  });
});

describe('tenant isolation', () => {
  it('does not sync into another tenant', async () => {
    expect(await listClosedTrades(bob.ctx)).toHaveLength(0);
  });

  it("will not read another tenant's credentials", async () => {
    expect(await readCredentialCiphertext(crossTenantContext(bob, alice))).toBeNull();
  });

  it('does nothing for a user with no connected account', async () => {
    const result = await syncMt5(bob.ctx, 'login');
    expect(result).toEqual({ status: 'skipped', reason: 'not-connected' });
    // And does not log a run that never happened.
    expect(await recentSyncLogs(bob.ctx)).toHaveLength(0);
  });
});

describe('reconnecting a different account', () => {
  it("does not mix two brokers' books together", async () => {
    const carol = await createTenantFixture();
    await connect(carol, '11112222');
    await syncMt5(carol.ctx, 'backfill');
    const first = await listClosedTrades(carol.ctx);
    expect(first.length).toBeGreaterThan(0);

    // Connecting a different login clears lastSyncAt, so the next sync backfills again
    // rather than resuming from a cursor that belonged to the previous account.
    await connect(carol, '99998888');
    const account = await getMt5Account(carol.ctx);
    expect(account?.login).toBe('99998888');
    expect(account?.lastSyncAt).toBeNull();
  });
});

describe('credentials at rest', () => {
  it('never stores the investor password in the clear', async () => {
    const row = await testDb.mt5Account.findFirstOrThrow({ where: { userId: alice.userId } });
    expect(row.investorPwEncrypted).not.toContain(INVESTOR_PASSWORD);
    expect(row.investorPwEncrypted.startsWith('v1.')).toBe(true);
  });

  it('is absent from every view the UI can reach', async () => {
    const account = await getMt5Account(alice.ctx);
    expect(JSON.stringify(account)).not.toContain(INVESTOR_PASSWORD);
    expect(Object.keys(account ?? {})).not.toContain('investorPwEncrypted');
  });
});
