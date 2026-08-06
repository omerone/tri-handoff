import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertTrades, type TradeUpsert } from '@/lib/db';
import { loadBook } from '@/lib/analytics/load';
import { computeMetrics, equityCurve } from '@/lib/analytics';
import { resolveRange, toTradeFilter, type TimeRange } from '@/lib/time/range';
import { cleanup, createTenantFixture, type Fixture } from '../helpers/fixtures';

/**
 * Reading the book through a window.
 *
 * The arithmetic that has to survive it is the equity curve's starting point. All-time, the
 * curve begins at the deposits. Through a window it has to begin at what the account was
 * actually worth when the window opened — deposits *plus* everything already realised — or
 * "this month" draws a curve that starts at the original deposit as though the preceding two
 * years had not happened, and the drawdown percentage under it is measured against that same
 * fiction. Nothing about that looks wrong on screen, which is why it is tested here.
 */

let alice: Fixture;

const DEPOSIT = 20_000;

/** Israel is UTC+2 in January and UTC+3 in June; these are wall-clock times in that zone. */
const at = (iso: string) => new Date(iso);

function trade(overrides: Partial<TradeUpsert> & { ticket: string }): TradeUpsert {
  return {
    kind: 'trade',
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    mae: null,
    mfe: null,
    openAt: at('2026-01-05T08:00:00Z'),
    closeAt: at('2026-01-05T12:00:00Z'),
    volume: 1,
    entryPrice: 1.1,
    exitPrice: 1.11,
    stopLoss: null,
    takeProfit: null,
    commission: 0,
    swap: 0,
    profit: 100,
    risk: null,
    rr: null,
    ...overrides,
  };
}

beforeAll(async () => {
  alice = await createTenantFixture();

  await upsertTrades(alice.ctx, [
    // The money that started the account. Not a trade, and not performance.
    trade({
      ticket: 'deposit-1',
      kind: 'balance',
      openAt: at('2025-12-31T10:00:00Z'),
      closeAt: at('2025-12-31T10:00:00Z'),
      profit: DEPOSIT,
    }),
    trade({ ticket: 'jan', closeAt: at('2026-01-20T12:00:00Z'), profit: 500 }),
    trade({ ticket: 'feb', closeAt: at('2026-02-10T12:00:00Z'), profit: 300 }),
    trade({ ticket: 'mar', closeAt: at('2026-03-11T12:00:00Z'), profit: -200 }),
    // 00:30 on the 1st of April in Tel Aviv, which is still the 31st of March in UTC. Whichever
    // month this lands in, both the calendar and the range have to agree on it.
    trade({ ticket: 'apr-early', closeAt: at('2026-03-31T21:30:00Z'), profit: 40 }),
  ]);
});

afterAll(cleanup);

const book = (range: TimeRange) => loadBook(alice.ctx, toTradeFilter(resolveRange(range)));

describe('the whole book', () => {
  it('starts the curve at the deposits and includes every trade', async () => {
    const all = await book({ kind: 'max' });

    expect(all.trades.map((t) => t.profit)).toEqual([500, 300, -200, 40]);
    expect(all.openingBalance).toBe(DEPOSIT);
    // Balance is where the curve ends: deposits plus everything realised.
    expect(all.openingBalance + computeMetrics(all.trades).net).toBe(DEPOSIT + 640);
  });
});

describe('a window', () => {
  const february: TimeRange = {
    kind: 'months',
    from: { year: 2026, month: 2 },
    to: { year: 2026, month: 2 },
  };

  it('opens at what the account was worth, not at the original deposit', async () => {
    const feb = await book(february);

    expect(feb.trades.map((t) => t.profit)).toEqual([300]);
    // January's 500 had already happened. A curve starting at 20,000 would be claiming it had not.
    expect(feb.openingBalance).toBe(DEPOSIT + 500);
  });

  it('draws a curve that ends on the real balance', async () => {
    const feb = await book(february);
    const curve = equityCurve(feb.trades, feb.openingBalance);

    expect(curve.at(-1)?.balance).toBe(DEPOSIT + 800);
  });

  it('leaves deposits inside the window out of the curve', async () => {
    // A deposit is not a trading result. If it were a point on the curve, the day the money
    // was wired would read as the best day of the month.
    const december: TimeRange = {
      kind: 'months',
      from: { year: 2025, month: 12 },
      to: { year: 2025, month: 12 },
    };
    const dec = await book(december);

    expect(dec.trades).toHaveLength(0);
    expect(dec.openingBalance).toBe(0);
  });

  it('places a trade by the analytics clock, not by UTC', async () => {
    // 2026-03-31T21:30Z is half past midnight on the 1st of April in Tel Aviv.
    const march = await book({
      kind: 'months',
      from: { year: 2026, month: 3 },
      to: { year: 2026, month: 3 },
    });
    const april = await book({
      kind: 'months',
      from: { year: 2026, month: 4 },
      to: { year: 2026, month: 4 },
    });

    expect(march.trades.map((t) => t.profit)).toEqual([-200]);
    expect(april.trades.map((t) => t.profit)).toEqual([40]);
  });

  it('includes a trade closed on the final day of a date range', async () => {
    const upToTheTenth = await book({
      kind: 'dates',
      from: { year: 2026, month: 2, day: 1 },
      to: { year: 2026, month: 2, day: 10 },
    });
    const upToTheNinth = await book({
      kind: 'dates',
      from: { year: 2026, month: 2, day: 1 },
      to: { year: 2026, month: 2, day: 9 },
    });

    expect(upToTheTenth.trades).toHaveLength(1);
    expect(upToTheNinth.trades).toHaveLength(0);
  });

  it('spans several months at once', async () => {
    const quarter = await book({
      kind: 'months',
      from: { year: 2026, month: 1 },
      to: { year: 2026, month: 3 },
    });

    expect(computeMetrics(quarter.trades).net).toBe(600);
    expect(quarter.openingBalance).toBe(DEPOSIT);
  });
});
