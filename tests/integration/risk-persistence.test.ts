import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptSecret } from '@/lib/crypto/secretbox';
import {
  connectMt5Account,
  createManualTrade,
  getTrade,
  listClosedTrades,
  upsertTrades,
} from '@/lib/db';
import type { TradeUpsert } from '@/lib/db';
import { syncMt5 } from '@/lib/mt5/sync';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * What a re-sync may and may not do to a risk figure it already stored.
 *
 * A client reported the symptom that started this: risk and R missing on almost every trade,
 * while the stop loss sat two rows below on the same screen. The cause was upstream — a symbol
 * specification read from a field the broker does not send — but the reason it spread across
 * the whole book, rather than only the trades synced during the broken window, is here. Risk
 * was written unconditionally, a sync re-reads the last two days on every run, and so one bad
 * specification fetch was enough to erase the figure on every recent trade.
 *
 * The distinction the guard has to draw is the interesting part, and it is why this is an
 * integration test rather than a unit one: a null risk beside a present stop is sometimes a
 * failure to price and sometimes the plain truth. Keeping it in the first case saves the book;
 * keeping it in the second leaves an R multiple measured against a stop that no longer sits
 * where it did — which is the same contradiction the client wrote in about, from the other
 * side, and worse for being invisible. So the write is told which it was, and only two reasons
 * make a null discardable.
 *
 * Every test here re-establishes the row it needs, so they can run in any order.
 */

let fixture: Fixture;
let accountId: string;
let baseline: TradeUpsert;
let tradeId: string;

/** The stored trade, as the screen would read it. */
async function stored() {
  const trade = (await getTrade(fixture.ctx, tradeId))!;
  return { risk: trade.risk, rr: trade.rr, stopLoss: trade.stopLoss };
}

/** Write the trade back as the sync found it originally, with fields overridden. */
async function resync(patch: Partial<TradeUpsert> = {}) {
  await upsertTrades(fixture.ctx, accountId, [{ ...baseline, ...patch }]);
}

beforeAll(async () => {
  fixture = await createTenantFixture();
  const account = await connectMt5Account(fixture.ctx, {
    login: '50214437',
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret('read-only'),
    accountCurrency: 'USD',
  });
  accountId = account.id;
  await syncMt5(fixture.ctx, 'backfill');

  // Any trade the sync priced: the property is about losing a number that was there.
  const priced = (await listClosedTrades(fixture.ctx)).find(
    (trade) => trade.risk !== null && trade.stopLoss !== null,
  );
  expect(priced, 'the fixture synced no trade with both a stop and a risk').toBeTruthy();
  tradeId = priced!.id;

  const full = (await getTrade(fixture.ctx, tradeId))!;
  baseline = {
    ticket: full.ticket,
    kind: full.kind,
    symbol: full.symbol,
    assetClass: full.assetClass,
    direction: full.direction,
    style: full.style,
    openAt: full.openAt,
    closeAt: full.closeAt,
    volume: full.volume,
    entryPrice: full.entryPrice,
    exitPrice: full.exitPrice,
    stopLoss: full.stopLoss,
    takeProfit: full.takeProfit,
    commission: full.commission,
    swap: full.swap,
    profit: full.profit,
    risk: full.risk,
    rr: full.rr,
    riskReason: null,
    mae: full.mae,
    mfe: full.mfe,
  };
});

afterAll(cleanup);

describe('a re-sync that could not price the trade', () => {
  it('keeps the risk when the specification fetch failed', async () => {
    await resync();
    const before = await stored();
    expect(before.risk).not.toBeNull();

    // What a broken `fetchSymbolSpecs` produces: the trade unchanged, the figure gone.
    await resync({ risk: null, rr: null, riskReason: 'unconvertible' });

    const after = await stored();
    expect(after.risk, 'a failed pricing run erased a good risk').toBe(before.risk);
    expect(after.rr).toBe(before.rr);
  });

  it('keeps it when the symbol went missing from the table', async () => {
    await resync();
    const before = await stored();

    await resync({ risk: null, rr: null, riskReason: 'unknown-symbol' });
    expect((await stored()).risk).toBe(before.risk);
  });
});

describe('a re-sync where the null is the truth', () => {
  it('clears it when the stop itself is gone', async () => {
    await resync();
    await resync({ stopLoss: null, risk: null, rr: null, riskReason: 'no-stop-loss' });

    const after = await stored();
    expect(after.stopLoss).toBeNull();
    expect(after.risk, 'an R multiple survived the stop it was measured against').toBeNull();
    expect(after.rr).toBeNull();
  });

  it('clears it when the stop was trailed past the entry', async () => {
    /*
     * The case a guard keyed on "is there a stop" gets wrong, and the one that hides.
     *
     * A trader trails their stop into profit. There is still a stop on the trade, so the naive
     * guard treats the null as a failure and keeps the old number — while the stop-loss field
     * beside it updates to the new level. The screen then shows an R multiple measured against
     * a price that is no longer the stop, with nothing visible to contradict it.
     */
    await resync();
    const before = await stored();
    expect(before.risk).not.toBeNull();

    const beyond =
      baseline.direction === 'long' ? baseline.entryPrice * 1.01 : baseline.entryPrice * 0.99;
    await resync({ stopLoss: beyond, risk: null, rr: null, riskReason: 'stop-beyond-entry' });

    const after = await stored();
    expect(after.stopLoss).toBeCloseTo(beyond, 4);
    expect(after.risk, 'an R survived a stop trailed past the entry').toBeNull();
    expect(after.rr).toBeNull();
  });

  it('still lets a recomputed value through', async () => {
    // The guard must not make the column write-once — a stop moved closer changes the answer.
    await resync({ risk: 250, rr: 1.5, riskReason: null });
    expect(await stored()).toMatchObject({ risk: 250, rr: 1.5 });
  });
});

describe('the trades no sync can reach', () => {
  it('prices a trade whose account link was cleared by an old disconnect', async () => {
    /*
     * Two thirds of the client's book, and the part fixing the code could not touch.
     *
     * `upsertTrades` matches on `(userId, mt5AccountId, ticket)`, so once a disconnect clears
     * the account a row is invisible to every sync that will ever run. Their book had 48 such
     * trades, 37 with a perfectly good stop and no risk, and they would have stayed blank
     * after the fix shipped — the complaint answered everywhere except where they were looking.
     */
    await resync();
    await testDb.trade.update({
      where: { id: tradeId },
      data: { mt5AccountId: null, risk: null, rr: null },
    });
    expect((await stored()).risk, 'the fixture did not reproduce an orphan').toBeNull();

    await syncMt5(fixture.ctx, 'manual');

    const after = await stored();
    expect(after.risk, 'an orphaned trade with a valid stop was left unpriced').not.toBeNull();
    expect(after.risk).toBeCloseTo(baseline.risk!, 6);

    /*
     * And the R has to be the same one the sync would have written.
     *
     * `profit` is stored already net of commission and swap. Adding them again here — which is
     * exactly what "the money that actually moved" invites you to write — subtracted the costs
     * twice: on a trade with real commission the repair produced 1.00R where the truth was
     * 1.25R. Nothing about that figure looks wrong, and it would have landed on all 37 of the
     * rows this pass exists to rescue. So the assertion is against the sync's own arithmetic,
     * not against a number typed into the test.
     */
    expect(after.rr, 'the repaired R disagrees with the one the sync computed').toBeCloseTo(
      baseline.rr!,
      6,
    );
  });

  it('leaves a hand-entered trade alone', async () => {
    /*
     * The entry price is optional on the manual form and a blank one is stored as zero, so the
     * distance to the stop becomes the stop's entire price. Priced, that put five thousand
     * dollars of risk on a trade that never had any — and manual trades carry a risk the trader
     * typed, so there was never anything here to repair in the first place.
     */
    const manualId = await createManualTrade(fixture.ctx, {
      symbol: 'US500',
      assetClass: 'indices',
      direction: 'short',
      style: 'day',
      openAt: new Date('2026-07-01T09:00:00.000Z'),
      closeAt: new Date('2026-07-01T15:00:00.000Z'),
      volume: 1,
      entryPrice: 0, // What the form stores when the field is left blank.
      exitPrice: 5000,
      stopLoss: 5010,
      takeProfit: null,
      commission: 0,
      swap: 0,
      profit: 10,
      risk: null,
      rr: null,
    });

    await syncMt5(fixture.ctx, 'manual');

    const after = await getTrade(fixture.ctx, manualId);
    expect(after!.entryPrice, 'the premise of this test has changed').toBe(0);
    expect(after!.risk, 'a blank entry price was turned into a risk figure').toBeNull();
  });
});
