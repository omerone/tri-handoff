import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeRr } from '../risk';
import { classifySymbol, findSymbolSpec } from '../symbols';
import { sessionOfHour, wallClock } from '@/lib/time/zone';
import { generateMockDeals, MOCK_ACCOUNT_CURRENCY, MOCK_QUOTE_RATES } from './generator';

/**
 * The mock generator must reproduce the client-approved prototype exactly.
 *
 * Rather than compare against a table copied out of the prototype by hand — which would only
 * prove that the copy matches itself — this extracts the prototype's own CORE block straight
 * out of `docs/tri-prototype.jsx` and runs it. If someone edits the generator and the demo
 * book shifts, this fails; if the prototype is ever revised, this fails too, which is the
 * correct outcome for a document the client signed off on.
 *
 * The prototype builds its dates with the *local* `Date` constructor, so it is run in a child
 * process pinned to the analytics timezone. Our own generator does not read the host zone at
 * all — it converts explicitly — which is why the two can be compared at all.
 */

type PrototypeTrade = {
  id: number;
  symbol: string;
  cls: string;
  direction: 'long' | 'short';
  style: 'day' | 'swing';
  open: number;
  close: number;
  hour: number;
  dow: number;
  risk: number;
  rr: number;
  pnl: number;
};

function runPrototypeGenerator(): PrototypeTrade[] {
  const source = readFileSync('docs/tri-prototype.jsx', 'utf8');
  const start = source.indexOf('// CORE-START');
  const end = source.indexOf('// CORE-END');
  expect(start, 'CORE-START marker missing from the prototype').toBeGreaterThan(-1);
  expect(end, 'CORE-END marker missing from the prototype').toBeGreaterThan(start);

  const core = source.slice(start, end);
  const program = `${core}\nprocess.stdout.write(JSON.stringify(TRADES));`;

  const output = execFileSync(process.execPath, ['--input-type=module', '-e', program], {
    // The prototype ran in the client's browser, on Israeli local time. Everything about its
    // weekday and session numbers assumes it.
    env: { ...process.env, TZ: 'Asia/Jerusalem' },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  return JSON.parse(output) as PrototypeTrade[];
}

let prototype: PrototypeTrade[];
const generated = generateMockDeals();
const trades = generated.deals.filter((deal) => deal.kind === 'trade');

beforeAll(() => {
  prototype = runPrototypeGenerator();
});

describe('parity with the prototype', () => {
  it('produces the same number of trades', () => {
    // 92 over the 91-day window, from seed 20260731. Pinned as well as compared, so that a
    // change which happened to break *both* generators the same way would still be caught.
    expect(prototype).toHaveLength(92);
    expect(trades).toHaveLength(prototype.length);
  });

  it('produces the same trade in the same order', () => {
    const mismatches: string[] = [];

    prototype.forEach((expected, index) => {
      const actual = trades[index]!;
      const open = wallClock(actual.openAt);
      const close = wallClock(actual.closeAt!);
      const expectedOpen = new Date(expected.open);
      const expectedClose = new Date(expected.close);

      const differences: string[] = [];
      if (actual.symbol !== expected.symbol) {
        differences.push(`symbol ${actual.symbol} ≠ ${expected.symbol}`);
      }
      if (actual.direction !== expected.direction) {
        differences.push(`direction ${actual.direction} ≠ ${expected.direction}`);
      }
      if (open.hour !== expected.hour) differences.push(`hour ${open.hour} ≠ ${expected.hour}`);
      if (open.weekday !== expected.dow) differences.push(`dow ${open.weekday} ≠ ${expected.dow}`);
      if (open.day !== expectedOpen.getDate()) {
        differences.push(`open day ${open.day} ≠ ${expectedOpen.getDate()}`);
      }
      if (close.day !== expectedClose.getDate()) {
        differences.push(`close day ${close.day} ≠ ${expectedClose.getDate()}`);
      }
      if (close.hour !== expectedClose.getHours()) {
        differences.push(`close hour ${close.hour} ≠ ${expectedClose.getHours()}`);
      }

      if (differences.length > 0) mismatches.push(`#${index}: ${differences.join(', ')}`);
    });

    expect(mismatches.slice(0, 10)).toEqual([]);
  });

  it('reproduces every P&L exactly, net of commission and swap', () => {
    const net = trades.map((deal) => Math.round(deal.profit + deal.commission + deal.swap));
    expect(net).toEqual(prototype.map((trade) => trade.pnl));
  });

  it('keeps day trades inside one calendar day', () => {
    // The prototype clamps them to 23:55 rather than letting them roll over, so a day trade
    // never appears on two squares of the calendar.
    const rollovers = trades.filter((deal) => {
      if (deal.closeAt === null) return false;
      const open = wallClock(deal.openAt);
      const close = wallClock(deal.closeAt);
      const sameDay = open.year === close.year && open.month === close.month && open.day === close.day;
      const isDayTrade = prototype[trades.indexOf(deal)]?.style === 'day';
      return isDayTrade && !sameDay;
    });
    expect(rollovers).toHaveLength(0);
  });

  it('trades only Monday to Friday', () => {
    const weekendOpens = trades.filter((deal) => {
      const day = wallClock(deal.openAt).weekday;
      return day === 0 || day === 6;
    });
    expect(weekendOpens).toHaveLength(0);
  });
});

describe('risk and RR round-trip through the production formula', () => {
  /**
   * The point of the whole exercise: the mock emits prices and stop losses, and the *sync's*
   * RR rule — not the generator — has to arrive back at the prototype's numbers. If this
   * passes, the demo data is exercising the same calculation a live account would.
   *
   * Prices are rounded to the digits a broker would actually print, so the round trip is
   * accurate to that rounding rather than exact.
   */
  it('recovers each trade risk to within price-rounding error', () => {
    const errors = trades.map((deal, index) => {
      const { risk } = computeRr(deal, {
        accountCurrency: MOCK_ACCOUNT_CURRENCY,
        quoteRates: MOCK_QUOTE_RATES,
      });
      const target = prototype[index]!.risk;
      return risk === null ? 1 : Math.abs(risk - target) / target;
    });

    expect(Math.max(...errors)).toBeLessThan(0.005);
  });

  it('recovers each R multiple to within price-rounding error', () => {
    const errors = trades.map((deal, index) => {
      const { rr } = computeRr(deal, {
        accountCurrency: MOCK_ACCOUNT_CURRENCY,
        quoteRates: MOCK_QUOTE_RATES,
      });
      return rr === null ? 1 : Math.abs(rr - prototype[index]!.rr);
    });

    expect(Math.max(...errors)).toBeLessThan(0.02);
  });

  it('gives every trade a stop loss, so RR coverage is complete on demo data', () => {
    expect(trades.every((deal) => deal.stopLoss !== null)).toBe(true);
    const withRr = trades.filter(
      (deal) =>
        computeRr(deal, {
          accountCurrency: MOCK_ACCOUNT_CURRENCY,
          quoteRates: MOCK_QUOTE_RATES,
        }).rr !== null,
    );
    expect(withRr).toHaveLength(trades.length);
  });

  it('places the stop on the losing side of the entry', () => {
    for (const deal of trades) {
      if (deal.direction === 'long') expect(deal.stopLoss!).toBeLessThan(deal.entryPrice);
      else expect(deal.stopLoss!).toBeGreaterThan(deal.entryPrice);
    }
  });

  it('moves the exit price in the direction the profit implies', () => {
    for (const deal of trades) {
      const gross = deal.profit;
      if (Math.abs(gross) < 1) continue; // Too small to survive price rounding.
      const movedUp = deal.exitPrice! > deal.entryPrice;
      const expectedUp = deal.direction === 'long' ? gross > 0 : gross < 0;
      expect(movedUp).toBe(expectedUp);
    }
  });
});

describe('production-only fields', () => {
  it('is stable across runs — the same seed gives the same book', () => {
    const again = generateMockDeals().deals.filter((deal) => deal.kind === 'trade');
    expect(again.map((d) => [d.ticket, d.entryPrice, d.stopLoss, d.volume])).toEqual(
      trades.map((d) => [d.ticket, d.entryPrice, d.stopLoss, d.volume]),
    );
  });

  it('gives every trade a tradeable volume and a known symbol spec', () => {
    for (const deal of trades) {
      expect(deal.volume).toBeGreaterThan(0);
      expect(findSymbolSpec(deal.symbol)).not.toBeNull();
    }
  });

  it('charges commission on every trade and swap only on positions held overnight', () => {
    for (const [index, deal] of trades.entries()) {
      expect(deal.commission).toBeLessThan(0);
      if (prototype[index]!.style === 'day') expect(deal.swap).toBe(0);
      else expect(deal.swap).toBeLessThan(0);
    }
  });

  it('includes the opening deposit as a balance deal, not a trade', () => {
    const balances = generated.deals.filter((deal) => deal.kind === 'balance');
    expect(balances).toHaveLength(1);
    expect(balances[0]!.profit).toBe(10_000);
    expect(balances[0]!.symbol).toBe('');
  });

  it('reclassifies gold as a commodity, where the prototype filed it under forex', () => {
    // SPEC §3.5 lists commodities as a dimension of its own; the prototype had no such
    // bucket and put XAUUSD in with the FX pairs. Recorded here so the divergence is a
    // decision rather than a surprise (PLAN conflict C6).
    const gold = trades.filter((deal) => deal.symbol === 'XAUUSD');
    expect(gold.length).toBeGreaterThan(0);
    expect(classifySymbol('XAUUSD')).toBe('commodities');
    expect(prototype.find((t) => t.symbol === 'XAUUSD')?.cls).toBe('forex');
  });

  it('spreads trades across all three sessions', () => {
    const sessions = new Set(trades.map((deal) => sessionOfHour(wallClock(deal.openAt).hour)));
    expect([...sessions].sort()).toEqual(['asia', 'london', 'ny']);
  });
});
