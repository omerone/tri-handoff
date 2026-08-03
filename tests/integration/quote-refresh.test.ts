import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createLongPosition,
  getLongPosition,
  listLongPositions,
  setPriceSource,
  trackAllOpenPositions,
  updateCurrentPrice,
} from '@/lib/db';
import { listTrackedSymbols } from '@/lib/db/quotes';
import { CHUNK, dueSymbols, refreshDueQuotes } from '@/lib/quotes/refresh';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * The refresh, end to end against the database and the mock feed.
 *
 * The cases that matter are the ones where being wrong is expensive or silent: spending more
 * credits than the plan allows, overwriting a price the user typed, or marking a position to
 * a quote in a currency it is not held in — which produces a plausible-looking number that is
 * wrong by an exchange rate.
 */

let alice: Fixture;
let bob: Fixture;

const buyDate = new Date(Date.UTC(2026, 0, 15));

async function addPosition(
  fixture: Fixture,
  overrides: Partial<Parameters<typeof createLongPosition>[1]> = {},
) {
  return createLongPosition(fixture.ctx, {
    symbol: 'AAPL',
    qty: 10,
    buyPrice: 100,
    buyDate,
    fees: 0,
    currency: 'USD',
    micCode: 'XNGS',
    priceSource: 'auto',
    ...overrides,
  });
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

/**
 * The refresh is global on purpose — one quote serves every tenant holding that listing — so
 * these tests share a mechanism with whatever else is in the development database. Two
 * consequences, and both were learned the hard way when the demo tenant's own positions were
 * switched onto the feed and half this file started failing:
 *
 *  1. counting what the refresh *did* only works if nothing else is due, so the assertions
 *     below are about the fixtures' own listings, not about totals;
 *  2. a test run must not spend the fixtures' credits marking somebody's real book to a mock
 *     price, so anything already tracked is stamped as just-fetched and drops out of the
 *     due list for the duration.
 */
const TEST_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'QQQ', 'SPY', 'VOO', 'BTC/USD', 'ETH/USD', 'NOTREAL'];

beforeEach(async () => {
  await testDb.quote.deleteMany({ where: { symbol: { in: TEST_SYMBOLS } } });
  await testDb.rateLimit.deleteMany({ where: { key: 'quotes:daily' } });

  const now = new Date();
  for (const key of await listTrackedSymbols()) {
    await testDb.quote.upsert({
      where: { symbol_micCode: { symbol: key.symbol, micCode: key.micCode } },
      create: { symbol: key.symbol, micCode: key.micCode, asOf: now, fetchedAt: now },
      update: { fetchedAt: now, asOf: now },
    });
  }
});

afterEach(async () => {
  await testDb.longPosition.deleteMany({
    where: { userId: { in: [alice.userId, bob.userId] } },
  });
});

afterAll(cleanup);

describe('what gets refreshed', () => {
  it('prices a tracked position and stamps it with the market’s own time', async () => {
    const position = await addPosition(alice);
    expect(position.currentPrice).toBe(100); // cost, until the feed says otherwise

    const outcome = await refreshDueQuotes();
    expect(outcome.updated).toBe(1);
    expect(outcome.positions).toBe(1);

    const after = await getLongPosition(alice.ctx, position.id);
    expect(after?.currentPrice).not.toBe(100);
    expect(after?.priceSource).toBe('auto');
  });

  it('leaves a manually priced position alone', async () => {
    const position = await addPosition(alice, { priceSource: 'manual' });
    await refreshDueQuotes();

    const after = await getLongPosition(alice.ctx, position.id);
    expect(after?.currentPrice).toBe(100);
  });

  it('takes a position off the feed the moment a price is typed into it', async () => {
    // Otherwise the refresh overwrites the correction a minute later, and the user has no way
    // of telling why the number they entered went away.
    const position = await addPosition(alice);
    await updateCurrentPrice(alice.ctx, position.id, 123.45);

    const after = await getLongPosition(alice.ctx, position.id);
    expect(after?.priceSource).toBe('manual');

    await refreshDueQuotes();
    expect((await getLongPosition(alice.ctx, position.id))?.currentPrice).toBe(123.45);
  });

  it('never touches a closed position', async () => {
    const position = await addPosition(alice);
    await testDb.longPosition.update({
      where: { id: position.id },
      data: { closedAt: new Date(), realizedPnl: 0, currentPrice: 111 },
    });

    await refreshDueQuotes();
    expect((await getLongPosition(alice.ctx, position.id))?.currentPrice).toBe(111);
  });

  it('charges one credit for a listing two people hold', async () => {
    await addPosition(alice);
    await addPosition(bob);

    const outcome = await refreshDueQuotes();
    expect(outcome.requested).toBe(1);
    expect(outcome.updated).toBe(1);
    // One quote, both books marked.
    expect(outcome.positions).toBe(2);
  });
});

describe('the currency guard', () => {
  it('refuses to mark a position to a price quoted in another currency', async () => {
    // Apple's London listing is in pounds. A position recorded in dollars must not take that
    // number: it would be wrong by the exchange rate and look entirely reasonable.
    const position = await addPosition(alice, { micCode: 'XLON', currency: 'USD' });

    const outcome = await refreshDueQuotes();
    expect(outcome.updated).toBe(1); // the quote is cached — it is simply not applied
    expect(outcome.positions).toBe(0);

    expect((await getLongPosition(alice.ctx, position.id))?.currentPrice).toBe(100);
  });

  it('applies it when the position is held in the listing’s own currency', async () => {
    const position = await addPosition(alice, { micCode: 'XLON', currency: 'GBP' });

    const outcome = await refreshDueQuotes();
    expect(outcome.positions).toBe(1);
    expect((await getLongPosition(alice.ctx, position.id))?.currentPrice).not.toBe(100);
  });
});

describe('listings the feed does not carry', () => {
  it('asks once, then backs off instead of retrying on every tick', async () => {
    await addPosition(alice, { symbol: 'NOTREAL', micCode: 'XNGS' });

    const first = await refreshDueQuotes();
    expect(first.requested).toBe(1);
    expect(first.updated).toBe(0);

    // The row that exists only to hold the back-off stamp.
    const row = await testDb.quote.findFirst({ where: { symbol: 'NOTREAL' } });
    expect(row?.price).toBeNull();

    const second = await refreshDueQuotes();
    expect(second.due).toBe(0);
    expect(second.requested).toBe(0);
  });
});

describe('spending', () => {
  it('asks for at most a chunk at a time, whatever the caller wants', async () => {
    // Twelve listings, a chunk of eight: the rest wait for the next tick rather than
    // exceeding the plan's per-minute credit allowance in one burst.
    const symbols = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'QQQ', 'SPY', 'VOO', 'BTC/USD', 'ETH/USD'];
    for (const symbol of symbols) {
      await addPosition(alice, { symbol, micCode: symbol.includes('/') ? '' : 'XNGS' });
    }

    const outcome = await refreshDueQuotes(new Date(), 999);
    expect(outcome.due).toBe(symbols.length);
    expect(outcome.requested).toBe(CHUNK);
    expect(outcome.requested).toBeLessThan(symbols.length);
  });

  it('stops dead when the daily budget is gone', async () => {
    await addPosition(alice);
    await addPosition(alice, { symbol: 'MSFT' });

    // Spend the budget from under it. `quotes:daily` is the same counter the refresh reserves
    // against, so this is what a day of heavy refreshing looks like.
    await testDb.rateLimit.create({
      data: {
        key: 'quotes:daily',
        count: 10_000_000,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const outcome = await refreshDueQuotes();
    expect(outcome.budgetSpent).toBe(true);
    expect(outcome.requested).toBe(0);
    expect(outcome.updated).toBe(0);
  });

  it('does nothing at all when no position is tracked', async () => {
    await addPosition(alice, { priceSource: 'manual' });
    expect(await dueSymbols(new Date())).toEqual([]);

    const outcome = await refreshDueQuotes();
    expect(outcome.requested).toBe(0);
  });
});

describe('switching an existing book onto the feed', () => {
  it('moves every open manual position and leaves closed ones alone', async () => {
    const open = await addPosition(alice, { priceSource: 'manual', micCode: '' });
    const closed = await addPosition(alice, { symbol: 'MSFT', priceSource: 'manual', micCode: '' });
    await testDb.longPosition.update({
      where: { id: closed.id },
      data: { closedAt: new Date(), realizedPnl: 0 },
    });

    expect(await trackAllOpenPositions(alice.ctx)).toBe(1);

    const positions = await listLongPositions(alice.ctx);
    expect(positions.find((p) => p.id === open.id)?.priceSource).toBe('auto');
    expect(positions.find((p) => p.id === closed.id)?.priceSource).toBe('manual');
  });

  it('prices a position that carries no MIC, which is every position that predates the feed', async () => {
    // `MSFT`, not `AAPL`: a bare ticker is one shared cache key, and the demo tenant's own
    // book holds a bare `AAPL` — the fixture would be reading somebody else's quote row.
    const position = await addPosition(alice, { symbol: 'MSFT', micCode: '', priceSource: 'manual' });
    await setPriceSource(alice.ctx, position.id, 'auto');

    const outcome = await refreshDueQuotes();
    expect(outcome.positions).toBe(1);
    expect((await getLongPosition(alice.ctx, position.id))?.currentPrice).not.toBe(100);
  });
});
