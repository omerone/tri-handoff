import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countSyncedTrades,
  createManualTrade,
  deleteLongPositionsByIds,
  deleteTradesByIds,
  deleteTradesForAccount,
  createLongPosition,
  listClosedTrades,
  listLongPositions,
  upsertTrades,
  type ManualTradeInput,
  type TradeUpsert,
} from '@/lib/db';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * Removing rows on purpose — the two paths that exist to do it.
 *
 * The trades table can now delete a handful of rows the trader ticked, and disconnecting an
 * account can take that account's history with it. Both are irreversible and both cross the
 * boundaries that the rest of this suite spends its time defending, so what is worth asserting
 * is not that a delete deletes: it is what each one *refuses* to touch.
 *
 *   - a bulk delete must not reach another trader's rows, however the id was obtained;
 *   - removing one account's history must leave the other account's alone;
 *   - and it must leave the manual rows alone too, because those are not any broker's history.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;
/** A third trader, for the two-account case: two books plus a hand-typed row. */
let traveller: Fixture;

const JULY = new Date('2026-07-15T12:00:00.000Z');

async function accountFor(ctx: { userId: string }, login: string): Promise<string> {
  const row = await testDb.mt5Account.create({
    data: {
      userId: ctx.userId,
      login,
      server: 'MetaQuotes-Demo',
      investorPwEncrypted: 'v1.test.ciphertext',
      accountCurrency: 'USD',
      status: 'connected',
    },
    select: { id: true },
  });
  return row.id;
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
    commission: 0,
    swap: 0,
    profit: 100,
    risk: 50,
    rr: 2,
    mae: null,
    mfe: null,
    riskReason: null,
    ...over,
  };
}

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

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
  traveller = await createTenantFixture();
});

// `cleanup` takes no arguments and disconnects: it tears down every fixture this file
// registered, and calling it mid-file would take the connection with it.
afterAll(cleanup);

describe('deleting several rows at once', () => {
  it('removes exactly the rows named and leaves the rest of the book', async () => {
    const account = await accountFor(alice.ctx, '90000001');
    await upsertTrades(alice.ctx, account, [synced('bulk-1'), synced('bulk-2'), synced('bulk-3')]);

    const before = await listClosedTrades(alice.ctx, {});
    const doomed = before.filter((trade) => trade.ticket !== 'bulk-3').map((trade) => trade.id);

    expect(await deleteTradesByIds(alice.ctx, doomed)).toBe(2);

    const after = await listClosedTrades(alice.ctx, {});
    expect(after.map((trade) => trade.ticket)).toEqual(['bulk-3']);
  });

  it('deletes nothing when handed an empty list, without a query', async () => {
    expect(await deleteTradesByIds(alice.ctx, [])).toBe(0);
    expect(await deleteLongPositionsByIds(alice.ctx, [])).toBe(0);
  });

  /*
   * The one that matters. Row ids are opaque but they are not secret — they travel to the
   * browser on every page of the table — so the scoping cannot rest on the caller having only
   * ever been given its own.
   */
  it("cannot reach another trader's rows with a borrowed id", async () => {
    const account = await accountFor(bob.ctx, '90000002');
    await upsertTrades(bob.ctx, account, [synced('bob-1')]);
    const [bobsTrade] = await listClosedTrades(bob.ctx, {});

    expect(await deleteTradesByIds(alice.ctx, [bobsTrade!.id])).toBe(0);
    expect(await listClosedTrades(bob.ctx, {})).toHaveLength(1);
  });

  it("cannot reach another trader's holdings either", async () => {
    const position = await createLongPosition(bob.ctx, {
      symbol: 'AAPL',
      qty: 10,
      buyPrice: 100,
      buyDate: JULY,
      fees: 0,
      currency: 'USD',
    });

    expect(await deleteLongPositionsByIds(alice.ctx, [position.id])).toBe(0);
    expect(await listLongPositions(bob.ctx)).toHaveLength(1);
  });
});

describe('removing an account’s history when it is disconnected', () => {
  it('takes that account’s synced trades and spares everything else', async () => {
    const leaving = await accountFor(traveller.ctx, '90000003');
    const staying = await accountFor(traveller.ctx, '90000004');

    await upsertTrades(traveller.ctx, leaving, [synced('gone-1'), synced('gone-2')]);
    await upsertTrades(traveller.ctx, staying, [synced('kept-1')]);
    await createManualTrade(traveller.ctx, manual({ symbol: 'MANUAL' }));

    expect(await countSyncedTrades(traveller.ctx, leaving)).toBe(2);

    // What `disconnectMt5Action` calls once the trader ticks the box.
    expect(await deleteTradesForAccount(traveller.ctx, leaving)).toBe(2);

    // `GBPUSD` is the staying account's synced row; `MANUAL` is the hand-typed one.
    const left = await listClosedTrades(traveller.ctx, {});
    expect(left.map((trade) => trade.symbol).sort()).toEqual(['GBPUSD', 'MANUAL']);
    // The other account's book is untouched, and so is the hand-typed row — which was never
    // any broker's history to begin with.
    expect(await countSyncedTrades(traveller.ctx, staying)).toBe(1);
  });
});
