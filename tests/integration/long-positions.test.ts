import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeLongPosition,
  createLongPosition,
  deleteLongPosition,
  getLongPosition,
  listJournalVocabulary,
  listLongPositions,
  updateCurrentPrice,
  updateLongPositionJournal,
} from '@/lib/db';
import { portfolioTotals, realizedPnlOnClose, valuePosition } from '@/lib/positions/valuation';
import {
  cleanup,
  createTenantFixture,
  crossTenantContext,
  type Fixture,
} from '../helpers/fixtures';

let alice: Fixture;
let bob: Fixture;

const buyDate = new Date(Date.UTC(2026, 0, 15));

async function seedPosition(fixture: Fixture, overrides: Record<string, unknown> = {}) {
  return createLongPosition(fixture.ctx, {
    symbol: 'AAPL',
    qty: 25,
    buyPrice: 182.4,
    buyDate,
    fees: 0,
    currency: 'USD',
    ...overrides,
  });
}

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('creating a position', () => {
  it('marks it at cost until the user says otherwise', async () => {
    // Starting the current price at zero would show a 100% loss on the day of purchase.
    const created = await seedPosition(alice);
    expect(created.currentPrice).toBe(created.buyPrice);
    expect(created.closedAt).toBeNull();
    expect(created.realizedPnl).toBeNull();
    expect(valuePosition(created, new Date()).unrealized).toBe(0);
  });

  it('round-trips quantities and prices as numbers', async () => {
    const created = await seedPosition(alice, { symbol: 'BTC', qty: 0.12, buyPrice: 58_200 });
    const found = await getLongPosition(alice.ctx, created.id);

    expect(found).toMatchObject({ symbol: 'BTC', qty: 0.12, buyPrice: 58_200 });
    expect(typeof found!.qty).toBe('number');
  });
});

describe('updating the price', () => {
  it('moves the value and stamps when it happened', async () => {
    const created = await seedPosition(bob, { symbol: 'QQQ', qty: 10, buyPrice: 418 });
    const before = created.valueUpdatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await updateCurrentPrice(bob.ctx, created.id, 512.3)).toBe(true);

    const after = await getLongPosition(bob.ctx, created.id);
    expect(after!.currentPrice).toBe(512.3);
    // The stamp is what tells the user how old the valuation is, so it has to move.
    expect(after!.valueUpdatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(valuePosition(after!, new Date()).unrealized).toBeCloseTo(943, 6);
  });

  it("will not update another tenant's position", async () => {
    const target = await seedPosition(alice, { symbol: 'NVDA', buyPrice: 100 });

    expect(await updateCurrentPrice(crossTenantContext(bob, alice), target.id, 999)).toBe(false);
    expect((await getLongPosition(alice.ctx, target.id))!.currentPrice).toBe(100);
  });
});

describe('closing a position', () => {
  it('stores the realized figure and stops it being valued as open', async () => {
    const created = await seedPosition(bob, { symbol: 'TSLA', qty: 10, buyPrice: 200, fees: 15 });
    const realized = realizedPnlOnClose(created, 250);

    expect(
      await closeLongPosition(bob.ctx, created.id, {
        sellPrice: 250,
        realizedPnl: realized,
        closedAt: new Date(),
      }),
    ).toBe(true);

    const closed = await getLongPosition(bob.ctx, created.id);
    expect(closed!.closedAt).not.toBeNull();
    expect(closed!.realizedPnl).toBeCloseTo(485, 6); // 2500 − (2000 + 15)
  });

  it('refuses to close an already-closed position', async () => {
    const created = await seedPosition(bob, { symbol: 'MSFT', qty: 5, buyPrice: 300 });
    await closeLongPosition(bob.ctx, created.id, {
      sellPrice: 320,
      realizedPnl: 100,
      closedAt: new Date(),
    });

    // Otherwise a double submit would overwrite a realized gain with a second one.
    expect(
      await closeLongPosition(bob.ctx, created.id, {
        sellPrice: 999,
        realizedPnl: 9_999,
        closedAt: new Date(),
      }),
    ).toBe(false);
    expect((await getLongPosition(bob.ctx, created.id))!.realizedPnl).toBe(100);
  });

  it('keeps the realized figure fixed even if the buy price is corrected later', async () => {
    // Realized P&L is a fact about a transaction that happened; recomputing it on read
    // would let a later edit rewrite a gain that was already banked.
    const created = await seedPosition(bob, { symbol: 'KO', qty: 100, buyPrice: 50 });
    await closeLongPosition(bob.ctx, created.id, {
      sellPrice: 60,
      realizedPnl: 1_000,
      closedAt: new Date(),
    });

    const stored = await getLongPosition(bob.ctx, created.id);
    expect(stored!.realizedPnl).toBe(1_000);
  });
});

describe('tenant isolation', () => {
  it("lists only the caller's own positions", async () => {
    const aliceIds = new Set((await listLongPositions(alice.ctx)).map((p) => p.id));
    const bobPositions = await listLongPositions(bob.ctx);

    expect(bobPositions.length).toBeGreaterThan(0);
    expect(bobPositions.some((position) => aliceIds.has(position.id))).toBe(false);
  });

  it('returns nothing through a forged context', async () => {
    expect(await listLongPositions(crossTenantContext(bob, alice))).toEqual([]);
  });

  it("will not read another tenant's position by id", async () => {
    const target = (await listLongPositions(alice.ctx))[0]!;
    expect(await getLongPosition(crossTenantContext(bob, alice), target.id)).toBeNull();
  });

  it("will not close another tenant's position", async () => {
    const target = (await listLongPositions(alice.ctx)).find((p) => p.closedAt === null)!;
    expect(
      await closeLongPosition(crossTenantContext(bob, alice), target.id, {
        sellPrice: 1,
        realizedPnl: -1,
        closedAt: new Date(),
      }),
    ).toBe(false);
    expect((await getLongPosition(alice.ctx, target.id))!.closedAt).toBeNull();
  });

  it("will not delete another tenant's position", async () => {
    const target = (await listLongPositions(alice.ctx))[0]!;
    expect(await deleteLongPosition(crossTenantContext(bob, alice), target.id)).toBe(false);
    expect(await getLongPosition(alice.ctx, target.id)).not.toBeNull();
  });

  it("does delete the caller's own position", async () => {
    const target = (await listLongPositions(alice.ctx))[0]!;
    expect(await deleteLongPosition(alice.ctx, target.id)).toBe(true);
    expect(await getLongPosition(alice.ctx, target.id)).toBeNull();
  });
});

/**
 * Selling a holding that was entered and then never marked to market.
 *
 * This is the ordinary case for anything bought and sold inside a few weeks, and it is the
 * one where the manual-price design could go wrong quietly: `currentPrice` is still the buy
 * price, so a close that leaned on it — rather than on the sell price the user typed — would
 * realize zero and look like a position that went nowhere.
 *
 * Its own tenant, so the ordering the isolation tests above rely on is left alone.
 */
describe('closing a position whose price was never updated', () => {
  let carol: Fixture;

  beforeAll(async () => {
    carol = await createTenantFixture();
  });

  it('realizes against the sell price, not the untouched current price', async () => {
    const created = await seedPosition(carol, {
      symbol: 'SHOP',
      qty: 40,
      buyPrice: 62.5,
      fees: 18,
    });
    // Nothing has been marked: the position is still carrying its purchase price.
    expect(created.currentPrice).toBe(62.5);

    const realized = realizedPnlOnClose(created, 71);
    const closedAt = new Date();
    expect(
      await closeLongPosition(carol.ctx, created.id, {
        sellPrice: 71,
        realizedPnl: realized,
        closedAt,
      }),
    ).toBe(true);

    const closed = await getLongPosition(carol.ctx, created.id)!;
    // 40 × 71 − (40 × 62.5 + 18) = 2840 − 2518
    expect(closed!.realizedPnl).toBeCloseTo(322, 6);
    expect(closed!.currentPrice).toBe(71);
    // The stamp becomes the close: after a sale the last known price is the price it sold at,
    // and it is exactly as old as the sale.
    expect(closed!.valueUpdatedAt.getTime()).toBe(closedAt.getTime());
  });

  it('realizes the fees, and only the fees, when it sells for what it cost', async () => {
    const created = await seedPosition(carol, { symbol: 'GOLD', qty: 5, buyPrice: 200, fees: 30 });

    await closeLongPosition(carol.ctx, created.id, {
      sellPrice: 200,
      realizedPnl: realizedPnlOnClose(created, 200),
      closedAt: new Date(),
    });

    // Flat on price is not flat on money.
    expect((await getLongPosition(carol.ctx, created.id))!.realizedPnl).toBeCloseTo(-30, 6);
  });

  it('drops out of the open roll-up entirely once closed', async () => {
    const before = portfolioTotals(await listLongPositions(carol.ctx), new Date());

    const created = await seedPosition(carol, { symbol: 'RIVN', qty: 10, buyPrice: 15, fees: 0 });
    const opened = portfolioTotals(await listLongPositions(carol.ctx), new Date());
    expect(opened.openCount).toBe(before.openCount + 1);
    expect(opened.cost).toBeCloseTo(before.cost + 150, 6);

    await closeLongPosition(carol.ctx, created.id, {
      sellPrice: 21,
      realizedPnl: realizedPnlOnClose(created, 21),
      closedAt: new Date(),
    });

    const after = portfolioTotals(await listLongPositions(carol.ctx), new Date());
    expect(after.openCount).toBe(before.openCount);
    expect(after.cost).toBeCloseTo(before.cost, 6);
    expect(after.realized).toBeCloseTo(before.realized + 60, 6);
  });

  it('refuses to re-price a closed position', async () => {
    // The stored price is the sale price and the realized figure was computed from it.
    // Letting a stray price update through would leave the row describing a sale that did
    // not happen, and `valueUpdatedAt` claiming the close was more recent than it was.
    const created = await seedPosition(carol, { symbol: 'PLTR', qty: 20, buyPrice: 30, fees: 0 });
    await closeLongPosition(carol.ctx, created.id, {
      sellPrice: 45,
      realizedPnl: realizedPnlOnClose(created, 45),
      closedAt: new Date(),
    });

    expect(await updateCurrentPrice(carol.ctx, created.id, 999)).toBe(false);

    const stored = await getLongPosition(carol.ctx, created.id);
    expect(stored!.currentPrice).toBe(45);
    expect(stored!.realizedPnl).toBeCloseTo(300, 6);
  });
});

/**
 * The journal on a holding.
 *
 * Same five columns as a synced trade, same tenant scoping, and — the part worth a test
 * rather than a read — the same *vocabulary*. A strategy typed on a long-term position has to
 * be suggested when writing up a day trade and the other way round, or the two books quietly
 * grow two spellings of one idea and the by-strategy breakdown stops meaning anything. That
 * is the whole reason `listJournalVocabulary` exists, and it read only one table until this.
 */
describe('the journal on a long position', () => {
  it('saves the five fields and reads them back', async () => {
    const created = await seedPosition(alice, { symbol: 'JRNL' });

    const saved = await updateLongPositionJournal(alice.ctx, created.id, {
      note: 'Bought the thesis, not the candle.',
      tags: ['conviction', 'Conviction', ' thesis '],
      rating: 4,
      mood: 'calm',
      strategy: 'Long-term hold',
    });
    expect(saved).toBe(true);

    const stored = await getLongPosition(alice.ctx, created.id);
    expect(stored!.journal.note).toBe('Bought the thesis, not the candle.');
    expect(stored!.journal.rating).toBe(4);
    expect(stored!.journal.mood).toBe('calm');
    expect(stored!.journal.strategy).toBe('Long-term hold');
    // Stored as given: the case-insensitive dedupe belongs to the action that parses the
    // comma-separated field, not to the column.
    expect(stored!.journal.tags).toEqual(['conviction', 'Conviction', ' thesis ']);
  });

  it('will not write to another tenant’s holding', async () => {
    const created = await seedPosition(bob, { symbol: 'NOTYOURS' });

    // The same shape as every other cross-tenant test here: an id that exists, asked for by
    // a context that does not own it, answers exactly as a missing row does.
    const written = await updateLongPositionJournal(crossTenantContext(alice, bob), created.id, {
      note: 'should not land',
      tags: [],
      rating: 5,
      mood: null,
      strategy: null,
    });
    expect(written).toBe(false);

    const stored = await getLongPosition(bob.ctx, created.id);
    expect(stored!.journal.note).toBeNull();
    expect(stored!.journal.rating).toBeNull();
  });

  it('offers what was typed on a holding when writing up a trade', async () => {
    const created = await seedPosition(alice, { symbol: 'VOCAB' });
    await updateLongPositionJournal(alice.ctx, created.id, {
      note: null,
      tags: ['macro-thesis'],
      rating: null,
      mood: 'patient',
      strategy: 'Position build',
    });

    const vocabulary = await listJournalVocabulary(alice.ctx);
    expect(vocabulary.strategies).toContain('Position build');
    expect(vocabulary.moods).toContain('patient');
    expect(vocabulary.tags).toContain('macro-thesis');
  });

  it('keeps one trader’s vocabulary out of another’s suggestions', async () => {
    const created = await seedPosition(bob, { symbol: 'PRIVATE' });
    await updateLongPositionJournal(bob.ctx, created.id, {
      note: null,
      tags: ['bobs-only-tag'],
      rating: null,
      mood: null,
      strategy: 'Bobs only strategy',
    });

    const vocabulary = await listJournalVocabulary(alice.ctx);
    expect(vocabulary.strategies).not.toContain('Bobs only strategy');
    expect(vocabulary.tags).not.toContain('bobs-only-tag');
  });
});
