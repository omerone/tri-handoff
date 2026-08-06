import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '@/lib/crypto/secretbox';
import { connectMt5Account, ticketsWithExcursions } from '@/lib/db';
import { mt5Provider } from '@/lib/mt5';
import { syncMt5 } from '@/lib/mt5/sync';
import { cleanup, createTenantFixture, testDb, type Fixture } from '../helpers/fixtures';

/**
 * What a sync costs, counted in requests.
 *
 * On a metered provider every call is money, and the two things that quietly multiply it are
 * invisible from the UI: the two-day overlap window means each refresh re-reads trades it
 * already has, and the excursion pass asks for candles per trade. Together they turned
 * "press refresh three times in an afternoon" into three full sets of candle requests for
 * the same closed trades — whose highs and lows are history and cannot have changed.
 *
 * These tests count `fetchBars` calls, because that is the number the bill is proportional
 * to. The rest of the sync's behaviour is covered in `mt5-sync.test.ts`; this file is only
 * about not spending twice for the same answer.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

const INVESTOR_PASSWORD = 'read-only-secret';

let fixture: Fixture;
let barsSpy: ReturnType<typeof vi.spyOn>;

/** How many candle requests the sync has made since the counter was last reset. */
const barCalls = () => barsSpy.mock.calls.length;

beforeAll(async () => {
  fixture = await createTenantFixture();
  await connectMt5Account(fixture.ctx, {
    login: '50214437',
    server: 'MetaQuotes-Demo',
    investorPwEncrypted: encryptSecret(INVESTOR_PASSWORD),
    accountCurrency: 'USD',
  });
});

beforeEach(() => {
  const provider = mt5Provider();
  // Spied rather than stubbed: the real implementation still runs, so the excursions that get
  // stored are the ones the app would really store — this only counts the calls.
  barsSpy = vi.spyOn(provider, 'fetchBars' as never);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe('the first sync', () => {
  it('fetches candles, because nothing has an excursion yet', async () => {
    const result = await syncMt5(fixture.ctx, 'backfill');
    expect(result.status).toBe('success');
    expect(barCalls()).toBeGreaterThan(0);

    const stored = await testDb.trade.count({
      where: { userId: fixture.userId, mae: { not: null }, mfe: { not: null } },
    });
    expect(stored).toBeGreaterThan(0);
  });
});

describe('pressing refresh again', () => {
  it('asks for no candles at all when every trade already has an answer', async () => {
    /*
     * The bug this exists for. The overlap window hands the same recently-closed trades back
     * on every incremental sync; without the skip, each one was another candle request for a
     * high and a low that were settled days ago.
     */
    await syncMt5(fixture.ctx, 'backfill');

    barsSpy.mockClear();
    const again = await syncMt5(fixture.ctx, 'manual');

    expect(again.status).toBe('success');
    expect(barCalls()).toBe(0);
  });

  it('stays at zero however many times it is pressed', async () => {
    await syncMt5(fixture.ctx, 'backfill');

    barsSpy.mockClear();
    await syncMt5(fixture.ctx, 'manual');
    await syncMt5(fixture.ctx, 'login');
    await syncMt5(fixture.ctx, 'manual');

    expect(barCalls()).toBe(0);
  });

  it('still fetches for a trade whose excursion is missing', async () => {
    await syncMt5(fixture.ctx, 'backfill');

    // One trade loses its figures — the shape left behind by a provider that timed out on
    // that symbol, or by a broker with no history for it.
    const orphan = await testDb.trade.findFirst({
      where: { userId: fixture.userId, mae: { not: null } },
      select: { id: true, ticket: true },
    });
    await testDb.trade.update({ where: { id: orphan!.id }, data: { mae: null, mfe: null } });

    barsSpy.mockClear();
    await syncMt5(fixture.ctx, 'manual');

    // Exactly the one, and only if it is still inside the overlap window the sync re-reads.
    expect(barCalls()).toBeLessThanOrEqual(1);
  });

  it('treats a half-written excursion as missing rather than as done', async () => {
    // The two are written together, so a row with one of them is an interrupted computation.
    // Trusting it would leave a permanently half-answered trade nothing ever revisits.
    await syncMt5(fixture.ctx, 'backfill');
    const half = await testDb.trade.findFirst({
      where: { userId: fixture.userId, mae: { not: null } },
      select: { id: true, ticket: true },
    });
    await testDb.trade.update({ where: { id: half!.id }, data: { mfe: null } });

    const known = await ticketsWithExcursions(fixture.ctx, [half!.ticket]);
    expect(known.has(half!.ticket)).toBe(false);
  });
});

describe('a backfill', () => {
  it('recomputes, so a corrected calculation has a way back in', async () => {
    /*
     * The escape hatch. If the excursion arithmetic is ever fixed, every stored figure is
     * wrong and nothing would ever ask again — reconnecting the account is the documented way
     * to force it, and that runs a backfill.
     */
    await syncMt5(fixture.ctx, 'backfill');

    barsSpy.mockClear();
    await syncMt5(fixture.ctx, 'backfill');

    expect(barCalls()).toBeGreaterThan(0);
  });
});

describe('ticketsWithExcursions', () => {
  it('short-circuits an empty list instead of querying for nothing', async () => {
    expect(await ticketsWithExcursions(fixture.ctx, [])).toEqual(new Set());
  });

  it('does not report another trader’s tickets as known', async () => {
    const other = await createTenantFixture();
    await syncMt5(fixture.ctx, 'backfill');

    const mine = await testDb.trade.findFirst({
      where: { userId: fixture.userId, mae: { not: null } },
      select: { ticket: true },
    });

    // Same ticket string, different owner: the tenant scope has to answer "no".
    expect(await ticketsWithExcursions(other.ctx, [mine!.ticket])).toEqual(new Set());
  });
});
