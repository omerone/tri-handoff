import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  getMt5Account,
  latestSyncLog,
  listCashFlow,
  listMt5Accounts,
  deleteTradesForAccount,
  disconnectMt5Account,
  upsertTrades,
  Mt5AccountLimitError,
  listClosedTrades,
  readCredentialCiphertexts,
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

/** A broker row, for the tests that write history directly rather than through the mock. */
function synced(ticket: string) {
  return {
    ticket,
    kind: 'trade' as const,
    symbol: 'GBPUSD',
    assetClass: 'forex' as const,
    direction: 'long' as const,
    style: 'day' as const,
    openAt: new Date('2026-07-15T09:00:00.000Z'),
    closeAt: new Date('2026-07-15T17:00:00.000Z'),
    volume: 1,
    entryPrice: 1.3,
    exitPrice: 1.31,
    stopLoss: 1.29,
    takeProfit: null,
    commission: -7,
    swap: 0,
    profit: 93,
    risk: 100,
    rr: 0.93,
    riskReason: null,
    mae: null,
    mfe: null,
  };
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
    expect(await readCredentialCiphertexts(crossTenantContext(bob, alice))).toEqual([]);
  });

  it('does nothing for a user with no connected account', async () => {
    const result = await syncMt5(bob.ctx, 'login');
    expect(result).toEqual({ status: 'skipped', reason: 'not-connected' });
    // And does not log a run that never happened.
    expect(await recentSyncLogs(bob.ctx)).toHaveLength(0);
  });
});

describe('backfilling a journal that already has rows', () => {
  /**
   * The production failure this exists to prevent.
   *
   * A journal holding a trade newer than anything the broker will return puts the
   * incremental cursor past the end of the history. Every sync then asks for a window that
   * cannot contain anything, imports nothing, and reports success — a green log that means
   * "no new deals" and "the connection is broken" in exactly the same words. A backfill is
   * the one instruction that has to escape the cursor, because it is the only way back.
   */
  it('reads the whole history even when the cursor sits past the end of it', async () => {
    const dave = await createTenantFixture();
    await connect(dave, '77776666');
    const account = await testDb.mt5Account.findFirstOrThrow({
      where: { userId: dave.userId },
      select: { id: true },
    });

    // Every mock deal closes by 2026-07-31; this one closes after all of them — and it belongs
    // to the account being synced, which is what puts that account's cursor past the end.
    await testDb.trade.create({
      data: {
        userId: dave.userId,
        mt5AccountId: account.id,
        ticket: 'newer-than-the-broker-has',
        symbol: 'EURUSD',
        assetClass: 'forex',
        direction: 'long',
        style: 'day',
        openAt: new Date('2026-08-04T09:00:00Z'),
        closeAt: new Date('2026-08-04T17:00:00Z'),
        volume: 1,
        entryPrice: 1.085,
        profit: 700,
      },
    });

    const incremental = await syncMt5(dave.ctx, 'login');
    expect(incremental.status === 'success' && incremental.imported).toBe(0);

    // Every deal the broker has, cash flow included — not the window the cursor allowed.
    const backfill = await syncMt5(dave.ctx, 'backfill');
    expect(backfill.status === 'success' && backfill.imported).toBe(
      generateMockDeals().deals.length,
    );
  });
});

describe('a second broker account', () => {
  /**
   * A trader running one account for day trades and another for swings.
   *
   * `connectMt5Account` used to be keyed on the user, so connecting the second account
   * *replaced* the first — silently, and the first account's trades were left behind pointing
   * at a row that now described a different broker account entirely. Keyed on the broker
   * account, the same login at the same server is still an update and anything else is a new
   * connection.
   */
  it('is added rather than replacing the first', async () => {
    const carol = await createTenantFixture();
    await connect(carol, '11112222');
    await connect(carol, '99998888');

    const accounts = await listMt5Accounts(carol.ctx);
    expect(accounts.map((a) => a.login).sort()).toEqual(['11112222', '99998888']);
  });

  it('keeps each account\'s trades attributed to it', async () => {
    const dora = await createTenantFixture();
    await connect(dora, '31313131');
    await connect(dora, '32323232');
    await syncMt5(dora.ctx, 'backfill');

    const accounts = await listMt5Accounts(dora.ctx);
    const rows = await testDb.trade.findMany({
      where: { userId: dora.userId },
      select: { mt5AccountId: true },
    });

    // The mock returns the same book for any credentials, so both accounts import it — which
    // is the point: on the old key the second would have overwritten the first row for row,
    // and the journal would have been half the size it should be with no error anywhere.
    expect(rows.length).toBeGreaterThan(0);
    for (const id of accounts.map((a) => a.id)) {
      expect(rows.filter((row) => row.mt5AccountId === id).length).toBeGreaterThan(0);
    }
  });

  it('gives each account its own cursor', async () => {
    // A swing account connected today must not inherit the day account's watermark and be
    // told there is nothing older than this week to fetch.
    const edith = await createTenantFixture();
    await connect(edith, '41414141');
    await syncMt5(edith.ctx, 'backfill');

    await connect(edith, '42424242');
    const result = await syncMt5(edith.ctx, 'login');

    expect(result.status).toBe('success');
    // The newly connected account has no history of its own, so an ordinary login sync — not a
    // backfill — still reads it from the beginning.
    expect(result.status === 'success' && result.imported).toBeGreaterThan(0);
  });

  it('lets one broker fail without losing the other account\'s trades', async () => {
    const fred = await createTenantFixture();
    await connect(fred, '51515151');
    // A row whose ciphertext cannot be decrypted stands in for a broker that will not answer:
    // the sync for that account throws, and the run must still deliver the other one.
    await testDb.mt5Account.create({
      data: {
        userId: fred.userId,
        login: '52525252',
        server: 'MetaQuotes-Demo',
        investorPwEncrypted: 'not-a-valid-ciphertext',
        status: 'connected',
      },
    });

    const result = await syncMt5(fred.ctx, 'backfill');

    expect(result.status).toBe('success');
    expect((await listClosedTrades(fred.ctx)).length).toBeGreaterThan(0);
    // And the failure is not swallowed: the log says which account could not be read.
    const log = await latestSyncLog(fred.ctx);
    expect(log?.error).toContain('52525252');
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

describe('the two-account limit', () => {
  /**
   * The screen offers two slots and says so. The database has to agree, because a limit that
   * only exists in the markup is a limit until someone opens two tabs — and every account past
   * the first is a real monthly charge on somebody's card.
   */
  it('refuses a third account', async () => {
    const grace = await createTenantFixture();
    await connect(grace, '91919191');
    await connect(grace, '92929292');

    await expect(connect(grace, '93939393')).rejects.toThrow(Mt5AccountLimitError);
    expect(await listMt5Accounts(grace.ctx)).toHaveLength(2);
  });

  it('still lets either of the two be reconnected', async () => {
    // A changed investor password, or simply running the wizard again. Counting the write
    // rather than the account would refuse exactly the person trying to fix their connection.
    const henry = await createTenantFixture();
    await connect(henry, '94949494');
    await connect(henry, '95959595');

    await expect(connect(henry, '94949494')).resolves.toBeUndefined();
    expect(await listMt5Accounts(henry.ctx)).toHaveLength(2);
  });

  it('counts per trader, not across the platform', async () => {
    const ivan = await createTenantFixture();
    const judy = await createTenantFixture();
    await connect(ivan, '96969696');
    await connect(ivan, '97979797');

    await expect(connect(judy, '98989898')).resolves.toBeUndefined();
    expect(await listMt5Accounts(judy.ctx)).toHaveLength(1);
  });
});

describe('what an account is for', () => {
  /**
   * The reason a trader keeps two accounts, and therefore the reason the calendar cannot have
   * the last word.
   *
   * `styleOf` derives day or swing from whether a position opened and closed on one calendar
   * day, which is the only evidence there is when nobody has said otherwise. Once someone
   * declares "this account is my swing book", deriving it again from the timestamps contradicts
   * them: a swing closed inside one session is still a swing, and filing it under day trades
   * splits one strategy across both breakdowns — exactly what having two accounts was meant to
   * stop, and what every screen that groups by style would then get wrong.
   */
  it('overrides the calendar for everything the account imports', async () => {
    const nina = await createTenantFixture();
    await connectMt5Account(nina.ctx, {
      login: '21212121',
      server: 'MetaQuotes-Demo',
      investorPwEncrypted: encryptSecret(INVESTOR_PASSWORD),
      accountCurrency: 'USD',
      purpose: 'swing',
    });

    await syncMt5(nina.ctx, 'backfill');

    const trades = await listClosedTrades(nina.ctx);
    expect(trades.length).toBeGreaterThan(0);
    // The mock book contains same-day trades; on the calendar rule some would be `day`.
    expect(generateMockDeals().deals.some((deal) => deal.closeAt && sameZonedDay(deal.openAt, deal.closeAt))).toBe(true);
    expect(trades.every((trade) => trade.style === 'swing')).toBe(true);
  });

  it('keeps the calendar rule for an account that never said', async () => {
    const oscar = await createTenantFixture();
    await connect(oscar, '22222222');

    await syncMt5(oscar.ctx, 'backfill');

    const trades = await listClosedTrades(oscar.ctx);
    for (const trade of trades) {
      expect(trade.style).toBe(sameZonedDay(trade.openAt, trade.closeAt!) ? 'day' : 'swing');
    }
  });

  it('sends two accounts to two books', async () => {
    const pete = await createTenantFixture();
    await connectMt5Account(pete.ctx, {
      login: '23232323',
      server: 'MetaQuotes-Demo',
      investorPwEncrypted: encryptSecret(INVESTOR_PASSWORD),
      accountCurrency: 'USD',
      purpose: 'swing',
    });
    await connectMt5Account(pete.ctx, {
      login: '24242424',
      server: 'MetaQuotes-Demo',
      investorPwEncrypted: encryptSecret(INVESTOR_PASSWORD),
      accountCurrency: 'USD',
      purpose: 'day',
    });

    await syncMt5(pete.ctx, 'backfill');

    const trades = await listClosedTrades(pete.ctx);
    // Every screen that groups by style — the statistics, the tabs, the breakdowns — reads
    // this column, so getting it right here is what makes all of them right at once.
    expect(trades.some((trade) => trade.style === 'swing')).toBe(true);
    expect(trades.some((trade) => trade.style === 'day')).toBe(true);
  });
});

describe('the second slot', () => {
  /**
   * The worst thing the bug hunt found: connecting the second account destroyed the first
   * account's book.
   *
   * `isDifferentAccount` compared the new login against the *first* account, so filling the
   * empty day slot read as replacing the swing one. The wizard then offered two buttons —
   * confirm, which deleted every synced trade and every balance snapshot the trader had, or
   * cancel — and there was no third path. Re-syncing does not undo it: `TradeUpsert` excludes
   * note, tags, rating, mood, strategy and both review answers on purpose.
   */
  it('does not touch the other slot when a different account replaces one', async () => {
    const kelly = await createTenantFixture();
    const swing = await testDb.mt5Account.create({
      data: {
        userId: kelly.userId,
        login: '31311111',
        server: 'MetaQuotes-Demo',
        purpose: 'swing',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });
    const day = await testDb.mt5Account.create({
      data: {
        userId: kelly.userId,
        login: '31322222',
        server: 'MetaQuotes-Demo',
        purpose: 'day',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });

    await upsertTrades(kelly.ctx, swing.id, [synced('9001'), synced('9002')]);
    await upsertTrades(kelly.ctx, day.id, [synced('9003')]);

    // Replacing the day account must take the day account's rows and nothing else.
    const removed = await deleteTradesForAccount(kelly.ctx, day.id);

    expect(removed).toBe(1);
    const left = await listClosedTrades(kelly.ctx);
    expect(left.map((trade) => trade.ticket).sort()).toEqual(['9001', '9002']);
  });
});

describe('disconnecting and reconnecting the same account', () => {
  /**
   * Deleting the row orphaned its trades, and the reconnected account got a new id — so
   * `upsertTrades`, keyed on `(user, account, ticket)`, matched nothing and inserted a second
   * copy of the whole history. Net P&L doubled and the same trade appeared in both tabs.
   */
  it('adopts its own history back instead of importing it twice', async () => {
    const liam = await createTenantFixture();
    await connect(liam, '33330000');
    await syncMt5(liam.ctx, 'backfill');
    const before = await listClosedTrades(liam.ctx);
    expect(before.length).toBeGreaterThan(0);

    await disconnectMt5Account(liam.ctx);
    // The row survives so the trades keep their attribution; the credential does not.
    const kept = await testDb.mt5Account.findFirstOrThrow({ where: { userId: liam.userId } });
    expect(kept.investorPwEncrypted).toBe('');
    expect(await listMt5Accounts(liam.ctx)).toHaveLength(0);
    // Closed positions only: the opening deposit is attributed to the account too, and
    // `listClosedTrades` excludes it by design.
    expect(
      await testDb.trade.count({
        where: { userId: liam.userId, mt5AccountId: kept.id, kind: 'trade' },
      }),
    ).toBe(before.length);

    await connect(liam, '33330000');
    await syncMt5(liam.ctx, 'backfill');

    const after = await listClosedTrades(liam.ctx);
    expect(after).toHaveLength(before.length);
  });

  it('does not abort when two accounts shared a ticket', async () => {
    // The unique index is NULLS NOT DISTINCT, so nulling one account's rows onto another's
    // used to collide and fail the delete with a constraint error.
    const mia = await createTenantFixture();
    const first = await testDb.mt5Account.create({
      data: {
        userId: mia.userId,
        login: '34340000',
        server: 'BrokerA-Live',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });
    const second = await testDb.mt5Account.create({
      data: {
        userId: mia.userId,
        login: '34341111',
        server: 'BrokerB-Live',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });
    await upsertTrades(mia.ctx, first.id, [synced('777')]);
    await upsertTrades(mia.ctx, second.id, [synced('777')]);

    await expect(disconnectMt5Account(mia.ctx, second.id)).resolves.toBeUndefined();
    expect(await testDb.trade.count({ where: { userId: mia.userId } })).toBe(2);
  });
});
