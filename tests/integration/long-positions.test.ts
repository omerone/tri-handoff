import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeLongPosition,
  createLongPosition,
  deleteLongPosition,
  getLongPosition,
  listLongPositions,
  updateCurrentPrice,
} from '@/lib/db';
import { realizedPnlOnClose, valuePosition } from '@/lib/positions/valuation';
import { cleanup, createTenantFixture, crossTenantContext, type Fixture } from '../helpers/fixtures';

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
