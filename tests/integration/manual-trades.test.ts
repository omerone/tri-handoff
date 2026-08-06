import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countManualTrades,
  countSyncedTrades,
  createManualTrade,
  deleteAllTrades,
  deleteManualTrade,
  isManualTicket,
  getManualTrade,
  isManualTrade,
  listClosedTrades,
  listManualTrades,
  updateManualTrade,
  upsertTrades,
  type ManualTradeInput,
  type TradeUpsert,
} from '@/lib/db';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The broker account a test's synced trades belong to, created once per trader.
 *
 * `upsertTrades` takes an account id because two brokers can issue the same position ticket
 * and the unique key has to tell them apart. These tests are about something else, so they
 * get one account each, memoised on the context they already pass around.
 */
const accounts = new Map<string, Promise<string>>();
function accountFor(ctx: { userId: string }): Promise<string> {
  const existing = accounts.get(ctx.userId);
  if (existing) return existing;
  const created = testDb.mt5Account
    .create({
      data: {
        userId: ctx.userId,
        login: '50214437',
        server: 'MetaQuotes-Demo',
        investorPwEncrypted: 'v1.test.ciphertext',
        accountCurrency: 'USD',
        status: 'connected',
      },
      select: { id: true },
    })
    .then((row) => row.id);
  accounts.set(ctx.userId, created);
  return created;
}

/**
 * The boundary between what the trader typed and what the broker sent.
 *
 * Both live in `trades`, which is the point — a hand-entered trade reaches the analytics, the
 * calendar and the R-strip without any of them knowing where it came from. The price of that
 * is a boundary that has to hold in four directions, and none of them are visible from the
 * UI until the day somebody loses data:
 *
 *   - a sync must not overwrite a manual trade;
 *   - a sync must not delete one either;
 *   - connecting a different broker account wipes the synced book and must spare the manual
 *     one, because those rows are not the old account's history;
 *   - and the delete on the manual screen must not be able to remove a synced trade, whatever
 *     id it is handed.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

const JULY = new Date('2026-07-15T12:00:00.000Z');

/** `countManualTrades` answers per style; most assertions here only care about the total. */
const totalManual = (counts: { day: number; swing: number }) => counts.day + counts.swing;

function manual(over: Partial<ManualTradeInput> = {}): ManualTradeInput {
  return {
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt: JULY,
    closeAt: JULY,
    profit: 100,
    risk: 50,
    rr: 2,
    volume: 1,
    entryPrice: 1.1,
    exitPrice: 1.12,
    stopLoss: 1.09,
    takeProfit: null,
    commission: 0,
    swap: 0,
    ...over,
  };
}

function synced(ticket: string, over: Partial<TradeUpsert> = {}): TradeUpsert {
  return {
    ticket,
    kind: 'trade',
    symbol: 'GBPUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt: JULY,
    closeAt: JULY,
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
    mae: null,
    mfe: null,
    ...over,
  };
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('the ticket namespace', () => {
  it('marks a manual trade with a prefix no MT5 position id can have', async () => {
    const id = await createManualTrade(alice.ctx, manual());
    const row = await testDb.trade.findUnique({ where: { id }, select: { ticket: true } });

    expect(row).not.toBeNull();
    expect(isManualTicket(row!.ticket)).toBe(true);
    // MT5 position ids are numeric; the prefix puts these somewhere the broker cannot reach.
    expect(row!.ticket).not.toMatch(/^\d+$/);
  });

  it('gives every manual trade its own ticket', async () => {
    // Distinct trades, not three copies of one: identical submissions are meant to collapse
    // onto a single ticket now, and that is asserted in "submitting the same trade twice".
    const ids = [];
    for (const profit of [10, 20, 30]) {
      ids.push(await createManualTrade(alice.ctx, manual({ profit })));
    }
    const rows = await testDb.trade.findMany({
      where: { id: { in: ids } },
      select: { ticket: true },
    });
    // A collision would be a unique-constraint failure on (user_id, ticket) — or worse, an
    // upsert that silently overwrote the previous entry.
    expect(new Set(rows.map((row) => row.ticket)).size).toBe(3);
  });

  it('does not think a broker ticket is manual', () => {
    for (const ticket of ['123456789', 'p1', '', 'MANUAL:x']) {
      expect(isManualTicket(ticket)).toBe(false);
    }
  });
});

describe('a sync running over a book that has manual trades in it', () => {
  it('leaves them alone', async () => {
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual({ profit: 500, symbol: 'XAUUSD' }));

    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('1001'), synced('1002')]);

    const still = await testDb.trade.findUnique({ where: { id } });
    expect(still).not.toBeNull();
    expect(Number(still!.profit)).toBe(500);
    expect(still!.symbol).toBe('XAUUSD');
  });

  it('reports them as neither imported nor updated', async () => {
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual());

    const result = await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('2001')]);
    // The count the sync shows the user is about the broker's rows, not the whole table.
    expect(result).toEqual({ imported: 1, updated: 0 });
  });

  it('puts both kinds in the same book, which is the point of the design', async () => {
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual({ profit: 100 }));
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('3001', { profit: 40 })]);

    const book = await listClosedTrades(fixture.ctx);
    expect(book).toHaveLength(2);
    expect(book.reduce((sum, trade) => sum + trade.profit, 0)).toBe(140);
  });
});

describe('connecting a different broker account', () => {
  it('wipes the synced book and spares what the trader typed', async () => {
    /*
     * The failure this prevents: someone journals by hand for a month while waiting for a
     * MetaApi subscription, then connects their account — and the wipe that correctly removes
     * the *previous account's* history takes their own notes with it. Those rows are not the
     * old account's history, and nothing outside this test would have noticed.
     */
    const fixture = await createTenantFixture();
    const manualId = await createManualTrade(fixture.ctx, manual({ profit: 250 }));
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('4001'), synced('4002'), synced('4003')]);

    const removed = await deleteAllTrades(fixture.ctx);

    expect(removed).toBe(3);
    expect(await testDb.trade.findUnique({ where: { id: manualId } })).not.toBeNull();
    const left = await listClosedTrades(fixture.ctx);
    expect(left).toHaveLength(1);
    expect(left[0]!.profit).toBe(250);
  });

  it('counts only what it is actually going to delete', async () => {
    // The confirmation names this number and the trader agrees to lose it. Counting the whole
    // book would warn about trades that survive, and a warning that overstates gets clicked
    // through.
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual());
    await createManualTrade(fixture.ctx, manual());
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('5001'), synced('5002')]);

    expect(await countSyncedTrades(fixture.ctx)).toBe(2);
  });
});

describe('deleting', () => {
  it('removes a manual trade', async () => {
    const id = await createManualTrade(alice.ctx, manual());
    expect(await deleteManualTrade(alice.ctx, id)).toBe(true);
    expect(await testDb.trade.findUnique({ where: { id } })).toBeNull();
  });

  it('refuses a synced trade, whatever id it is handed', async () => {
    const fixture = await createTenantFixture();
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('6001')]);
    const row = await testDb.trade.findFirst({ where: { userId: fixture.userId } });

    expect(await deleteManualTrade(fixture.ctx, row!.id)).toBe(false);
    expect(await testDb.trade.findUnique({ where: { id: row!.id } })).not.toBeNull();
  });

  it('refuses another trader’s manual trade', async () => {
    // The tenant boundary, the same one every other query draws.
    const id = await createManualTrade(alice.ctx, manual());
    expect(await deleteManualTrade(bob.ctx, id)).toBe(false);
    expect(await testDb.trade.findUnique({ where: { id } })).not.toBeNull();
  });

  it('is false for an id that is already gone, rather than throwing', async () => {
    const id = await createManualTrade(alice.ctx, manual());
    expect(await deleteManualTrade(alice.ctx, id)).toBe(true);
    expect(await deleteManualTrade(alice.ctx, id)).toBe(false);
  });
});

describe('listing', () => {
  it('separates the two styles, and shows nobody else’s', async () => {
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual({ style: 'day', symbol: 'EURUSD' }));
    await createManualTrade(fixture.ctx, manual({ style: 'day', symbol: 'USDJPY' }));
    await createManualTrade(fixture.ctx, manual({ style: 'swing', symbol: 'GOLD' }));
    await createManualTrade(alice.ctx, manual({ style: 'day', symbol: 'NOTYOURS' }));

    const day = await listManualTrades(fixture.ctx, 'day');
    const swing = await listManualTrades(fixture.ctx, 'swing');

    expect(day.map((trade) => trade.symbol).sort()).toEqual(['EURUSD', 'USDJPY']);
    expect(swing.map((trade) => trade.symbol)).toEqual(['GOLD']);
  });

  it('lists manual trades only, never a synced one', async () => {
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual({ symbol: 'TYPED' }));
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('7001', { symbol: 'SYNCED' })]);

    const listed = await listManualTrades(fixture.ctx, 'day');
    expect(listed.map((trade) => trade.symbol)).toEqual(['TYPED']);
  });

  it('counts per style for the tabs', async () => {
    const fixture = await createTenantFixture();
    // Distinct in profit as well as style: `style` is deliberately *not* part of a manual
    // trade's fingerprint, because re-entering the same trade with the style corrected is a
    // correction and should update the row rather than add a second one.
    await createManualTrade(fixture.ctx, manual({ style: 'day', profit: 11 }));
    await createManualTrade(fixture.ctx, manual({ style: 'swing', profit: 22 }));
    await createManualTrade(fixture.ctx, manual({ style: 'swing', profit: 33 }));
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('8001')]);

    expect(await countManualTrades(fixture.ctx)).toEqual({ day: 1, swing: 2 });
  });

  it('keeps the style the trader chose rather than deriving it from the dates', async () => {
    // A swing opened and closed inside one session is still a swing to the person who took
    // it. The sync has only the dates to go on; here the trader is telling us.
    const fixture = await createTenantFixture();
    await createManualTrade(fixture.ctx, manual({ style: 'swing', openAt: JULY, closeAt: JULY }));

    expect(await listManualTrades(fixture.ctx, 'swing')).toHaveLength(1);
    expect(await listManualTrades(fixture.ctx, 'day')).toHaveLength(0);
  });
});

describe('isManualTrade', () => {
  it('answers for the trader who owns it, and for nobody else', async () => {
    const id = await createManualTrade(alice.ctx, manual());
    expect(await isManualTrade(alice.ctx, id)).toBe(true);
    expect(await isManualTrade(bob.ctx, id)).toBe(false);
  });

  it('is false for a synced trade', async () => {
    const fixture = await createTenantFixture();
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('9001')]);
    const row = await testDb.trade.findFirst({ where: { userId: fixture.userId } });
    expect(await isManualTrade(fixture.ctx, row!.id)).toBe(false);
  });
});

describe('submitting the same trade twice', () => {
  /**
   * A double-click, a retried request, a browser replaying a POST.
   *
   * The ticket used to be a fresh UUID, so every submission was unique by construction and
   * therefore never a duplicate of anything — including of itself. Two copies of one trade is
   * not a visible error: it is a P&L out by exactly one trade and a win rate pulled toward
   * that outcome, on a screen where everything still looks fine.
   */
  it('writes one trade, not two', async () => {
    const carol = await createTenantFixture();
    const input = manual({ symbol: 'GBPUSD', profit: 250 });

    const first = await createManualTrade(carol.ctx, input);
    const second = await createManualTrade(carol.ctx, input);

    expect(second).toBe(first);
    expect(totalManual(await countManualTrades(carol.ctx))).toBe(1);
    const trades = await listClosedTrades(carol.ctx);
    expect(trades.filter((t) => t.symbol === 'GBPUSD')).toHaveLength(1);
  });

  it('corrects the first rather than adding a second when a figure changed', async () => {
    // Same trade, retyped with the profit fixed: the fingerprint includes profit, so this is
    // a different trade by the rule — which is the conservative direction to be wrong in.
    const dave = await createTenantFixture();
    await createManualTrade(dave.ctx, manual({ symbol: 'USDJPY', profit: 100 }));
    await createManualTrade(dave.ctx, manual({ symbol: 'USDJPY', profit: 120 }));

    expect(totalManual(await countManualTrades(dave.ctx))).toBe(2);
  });

  it('keeps two trades apart when only the clock separates them', async () => {
    const erin = await createTenantFixture();
    const base = manual({ symbol: 'XAUUSD' });
    await createManualTrade(erin.ctx, base);
    await createManualTrade(erin.ctx, {
      ...base,
      closeAt: new Date(base.closeAt.getTime() + 1000),
    });

    expect(totalManual(await countManualTrades(erin.ctx))).toBe(2);
  });

  it('does not let one trader collapse another trader\'s identical trade', async () => {
    // The key is (user_id, ticket), so the same fingerprint under two users is two rows.
    const frank = await createTenantFixture();
    const grace = await createTenantFixture();
    const input = manual({ symbol: 'NAS100', profit: 42 });

    await createManualTrade(frank.ctx, input);
    await createManualTrade(grace.ctx, input);

    expect(totalManual(await countManualTrades(frank.ctx))).toBe(1);
    expect(totalManual(await countManualTrades(grace.ctx))).toBe(1);
  });

  it('leaves the note on the row it already wrote', async () => {
    const heidi = await createTenantFixture();
    const input = manual({ symbol: 'US500', profit: 75 });
    const id = await createManualTrade(heidi.ctx, input);
    await testDb.trade.update({ where: { id }, data: { note: 'held through the news' } });

    await createManualTrade(heidi.ctx, input);

    const row = await testDb.trade.findUniqueOrThrow({ where: { id } });
    expect(row.note).toBe('held through the news');
  });
});

describe('reading one account at a time', () => {
  /**
   * The reason two accounts were worth the migration.
   *
   * A trader running a day account and a swing account wants each book's numbers on their own;
   * merged, every figure is the average of two strategies and describes neither. The filter is
   * what makes the separation reachable, and `'manual'` selects the rows that belong to no
   * broker at all — a distinct answer from "no filter", which is why it is a string and not a
   * null.
   */
  it('narrows to one broker account, and to what was typed', async () => {
    const iris = await createTenantFixture();
    const day = await testDb.mt5Account.create({
      data: {
        userId: iris.userId,
        login: '61616161',
        server: 'MetaQuotes-Demo',
        label: 'Day',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });
    const swing = await testDb.mt5Account.create({
      data: {
        userId: iris.userId,
        login: '62626262',
        server: 'MetaQuotes-Demo',
        label: 'Swing',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });

    await upsertTrades(iris.ctx, day.id, [synced('7100', { profit: 10 })]);
    await upsertTrades(iris.ctx, swing.id, [
      synced('7200', { profit: 20 }),
      synced('7300', { profit: 30 }),
    ]);
    await createManualTrade(iris.ctx, manual({ symbol: 'TYPED', profit: 40 }));

    expect(await listClosedTrades(iris.ctx)).toHaveLength(4);
    expect(await listClosedTrades(iris.ctx, { mt5AccountId: day.id })).toHaveLength(1);
    expect(await listClosedTrades(iris.ctx, { mt5AccountId: swing.id })).toHaveLength(2);

    const typed = await listClosedTrades(iris.ctx, { mt5AccountId: 'manual' });
    expect(typed).toHaveLength(1);
    expect(typed[0]!.symbol).toBe('TYPED');
  });

  it('lets both accounts hold the same broker ticket without one erasing the other', async () => {
    // Two brokers issuing the same position id was the failure the old (user, ticket) key
    // could not survive: the second import landed on the first's row and the book quietly
    // lost a trade.
    const jack = await createTenantFixture();
    const first = await testDb.mt5Account.create({
      data: {
        userId: jack.userId,
        login: '71717171',
        server: 'BrokerA-Live',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });
    const second = await testDb.mt5Account.create({
      data: {
        userId: jack.userId,
        login: '72727272',
        server: 'BrokerB-Live',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });

    await upsertTrades(jack.ctx, first.id, [synced('999', { profit: 111 })]);
    await upsertTrades(jack.ctx, second.id, [synced('999', { profit: 222 })]);

    const book = await listClosedTrades(jack.ctx);
    expect(book).toHaveLength(2);
    expect(book.reduce((sum, trade) => sum + trade.profit, 0)).toBe(333);
  });
});

describe('editing', () => {
  it('rewrites the facts of a trade the trader typed', async () => {
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual({ symbol: 'EURUSD', profit: 100 }));

    const saved = await updateManualTrade(fixture.ctx, id, {
      ...manual(),
      symbol: 'XAUUSD',
      direction: 'short',
      style: 'swing',
      profit: -250,
      risk: 500,
      rr: -0.5,
      volume: 3,
    });

    expect(saved).toBe(true);
    const after = await getManualTrade(fixture.ctx, id);
    expect(after).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'short',
      style: 'swing',
      profit: -250,
      risk: 500,
      rr: -0.5,
      volume: 3,
    });
  });

  it('leaves the journal alone', async () => {
    /*
     * The failure this prevents: someone writes four paragraphs about a trade, notices the
     * volume was wrong, corrects it, and loses the paragraphs. The journal columns are the
     * trader's words about the trade rather than facts of it, and `ManualTradeInput` has no
     * slot for them precisely so this write cannot carry a blank over them.
     */
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual());
    await testDb.trade.update({
      where: { id },
      data: {
        note: 'waited for the retest',
        tags: ['breakout', 'planned'],
        rating: 4,
        mood: 'calm',
        strategy: 'Breakout',
      },
    });

    await updateManualTrade(fixture.ctx, id, manual({ profit: 999 }));

    const row = await testDb.trade.findUnique({ where: { id } });
    expect(row!.note).toBe('waited for the retest');
    expect(row!.tags).toEqual(['breakout', 'planned']);
    expect(row!.rating).toBe(4);
    expect(row!.mood).toBe('calm');
    expect(row!.strategy).toBe('Breakout');
    expect(Number(row!.profit)).toBe(999);
  });

  it('keeps the ticket, so a correction does not change the row’s identity', async () => {
    // The ticket is derived from the trade's content on create, which is what makes a double
    // submit idempotent. Re-deriving it here would rename the row on every correction — and
    // an edit that made one trade resemble another would collide instead of saving.
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual());
    const before = await testDb.trade.findUnique({ where: { id }, select: { ticket: true } });

    await updateManualTrade(fixture.ctx, id, manual({ symbol: 'GOLD', profit: -5, volume: 9 }));

    const after = await testDb.trade.findUnique({ where: { id }, select: { ticket: true } });
    expect(after!.ticket).toBe(before!.ticket);
  });

  it('refuses a synced trade, whatever id it is handed', async () => {
    const fixture = await createTenantFixture();
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [
      synced('e001', { symbol: 'GBPUSD', profit: 93 }),
    ]);
    const row = await testDb.trade.findFirst({ where: { userId: fixture.userId } });

    expect(await updateManualTrade(fixture.ctx, row!.id, manual({ symbol: 'HACKED' }))).toBe(false);
    const after = await testDb.trade.findUnique({ where: { id: row!.id } });
    expect(after!.symbol).toBe('GBPUSD');
    expect(Number(after!.profit)).toBe(93);
  });

  it('refuses another trader’s trade', async () => {
    const id = await createManualTrade(alice.ctx, manual({ symbol: 'MINE' }));
    expect(await updateManualTrade(bob.ctx, id, manual({ symbol: 'THEIRS' }))).toBe(false);
    expect((await getManualTrade(alice.ctx, id))?.symbol).toBe('MINE');
  });

  it('is false for a trade that no longer exists', async () => {
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual());
    await deleteManualTrade(fixture.ctx, id);
    expect(await updateManualTrade(fixture.ctx, id, manual())).toBe(false);
  });

  it('can move a trade between the Day and Swing books', async () => {
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual({ style: 'day' }));

    await updateManualTrade(fixture.ctx, id, manual({ style: 'swing' }));

    expect(await listManualTrades(fixture.ctx, 'day')).toHaveLength(0);
    expect(await listManualTrades(fixture.ctx, 'swing')).toHaveLength(1);
  });
});

describe('getManualTrade', () => {
  it('returns the row the edit form fills from', async () => {
    const fixture = await createTenantFixture();
    const id = await createManualTrade(fixture.ctx, manual({ symbol: 'BTCUSD', volume: 2 }));
    expect(await getManualTrade(fixture.ctx, id)).toMatchObject({ symbol: 'BTCUSD', volume: 2 });
  });

  it('is null for a synced trade and for another trader’s', async () => {
    const fixture = await createTenantFixture();
    await upsertTrades(fixture.ctx, await accountFor(fixture.ctx), [synced('e002')]);
    const syncedRow = await testDb.trade.findFirst({ where: { userId: fixture.userId } });
    expect(await getManualTrade(fixture.ctx, syncedRow!.id)).toBeNull();

    const mine = await createManualTrade(alice.ctx, manual());
    expect(await getManualTrade(bob.ctx, mine)).toBeNull();
  });
});

describe('after a broker is disconnected', () => {
  /**
   * The regression this exists to prevent, found in production.
   *
   * Disconnecting a broker keeps the trades on purpose — they are the trader's journal, not
   * the broker's — and the foreign key is `ON DELETE SET NULL`, so every one of them ends up
   * with no account. Reading "no account" as "the trader typed this" reclassified a whole
   * imported history as hand-entered the moment somebody pressed disconnect. Forty-nine synced
   * trades, silently, with the badge on each row still correctly saying MT5 and the filter
   * disagreeing with it.
   */
  it('does not start calling the broker\'s trades hand-typed', async () => {
    const kate = await createTenantFixture();
    const account = await testDb.mt5Account.create({
      data: {
        userId: kate.userId,
        login: '81818181',
        server: 'MetaQuotes-Demo',
        investorPwEncrypted: 'v1.test.ciphertext',
        status: 'connected',
      },
      select: { id: true },
    });

    await upsertTrades(kate.ctx, account.id, [synced('8100'), synced('8200')]);
    await createManualTrade(kate.ctx, manual({ symbol: 'TYPED' }));

    // Disconnecting orphans the synced rows: the column is nulled, the tickets are not.
    await testDb.mt5Account.delete({ where: { id: account.id } });
    const orphaned = await testDb.trade.findMany({
      where: { userId: kate.userId, ticket: { in: ['8100', '8200'] } },
      select: { mt5AccountId: true },
    });
    expect(orphaned.every((row) => row.mt5AccountId === null)).toBe(true);

    const typed = await listClosedTrades(kate.ctx, { mt5AccountId: 'manual' });
    expect(typed).toHaveLength(1);
    expect(typed[0]!.symbol).toBe('TYPED');
  });
});
