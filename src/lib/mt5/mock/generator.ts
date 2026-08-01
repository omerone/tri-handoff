import { stopDistanceForRisk, priceMoveForProfit } from '../risk';
import { findSymbolSpec, type SymbolSpec } from '../symbols';
import type { Mt5Deal } from '../types';
import { fromWallClock } from '@/lib/time/zone';

/**
 * Deterministic demo data, mirroring the generator in docs/tri-prototype.jsx.
 *
 * Two things have to be true at once, and they pull in opposite directions.
 *
 * 1. **The numbers must match the prototype the client signed off.** Same trades, same
 *    symbols, same hours, same R multiples, same P&L — so the production dashboard can be
 *    held next to the prototype and compared. That means reproducing its `mulberry32`
 *    sequence *call for call*: every extra `rnd()` shifts the whole stream and produces a
 *    different, equally plausible book.
 *
 * 2. **It must exercise the real pipeline.** The prototype invented `rr`, `risk` and `pnl`
 *    directly; it had no prices and no stop losses. Feeding those straight in would mean the
 *    RR rule — the client's headline metric — is never executed against the demo data, and a
 *    bug in it would only ever surface on a live account.
 *
 * The resolution: `rnd` reproduces the prototype's stream exactly and decides everything the
 * prototype decided. A second, independent stream (`aux`) supplies what only production
 * needs — volume, entry price, commission. Then the stop loss and exit price are derived
 * *backwards* through the very functions the sync uses, so that when the sync computes risk
 * and RR from these prices it arrives back at the prototype's numbers. The demo data is
 * therefore both a faithful copy and a real end-to-end exercise of the calculation.
 */

// --- the prototype's PRNG, unchanged -----------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MOCK_SEED = 20260731;

/** The prototype's own tables, in its own order — `pick` indexes into them. */
const SYMBOLS: Record<string, readonly string[]> = {
  forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
  crypto: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
  indices: ['US500', 'NAS100', 'GER40'],
  stocks: ['AAPL', 'NVDA', 'TSLA'],
};
const CLASSES = ['forex', 'crypto', 'indices', 'stocks'] as const;

export const MOCK_START_BALANCE = 10_000;
export const MOCK_ACCOUNT_CURRENCY = 'USD';
/** GER40 is quoted in euros; a dollar account needs this to price its risk. */
export const MOCK_QUOTE_RATES: Record<string, number> = { EURUSD: 1.08 };

/** The last day of the generated window — the prototype's `new Date(2026, 6, 31)`. */
const END_DATE = { year: 2026, month: 7, day: 31 };
const DAYS_BACK = 91;

/** Indicative prices, jittered per trade so the book doesn't look printed. */
const BASE_PRICE: Record<string, number> = {
  EURUSD: 1.085,
  GBPUSD: 1.27,
  USDJPY: 152.4,
  XAUUSD: 2350,
  BTCUSD: 64000,
  ETHUSD: 3200,
  SOLUSD: 150,
  US500: 5200,
  NAS100: 18200,
  GER40: 18500,
  AAPL: 230,
  NVDA: 135,
  TSLA: 250,
};

/** Lot sizes a retail account would actually trade, per asset class. */
const VOLUME_RANGE: Record<string, readonly [number, number]> = {
  forex: [0.05, 0.5],
  commodities: [0.05, 0.3],
  crypto: [0.02, 0.2],
  indices: [0.1, 1],
  stocks: [1, 20],
  other: [0.1, 1],
};

// --- civil-calendar helpers --------------------------------------------------

type Civil = { year: number; month: number; day: number };

const toDayNumber = (c: Civil): number => Date.UTC(c.year, c.month - 1, c.day) / 86_400_000;

function fromDayNumber(days: number): Civil & { weekday: number } {
  const date = new Date(days * 86_400_000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// --- generator ---------------------------------------------------------------

export type MockDealSet = {
  deals: Mt5Deal[];
  startBalance: number;
  currency: string;
  quoteRates: Record<string, number>;
};

export function generateMockDeals(seed: number = MOCK_SEED): MockDealSet {
  const rnd = mulberry32(seed);
  // A distinct stream, so adding production-only fields cannot perturb the prototype's.
  // The constant is the golden-ratio mix used by hash functions; any fixed value would do,
  // this one just guarantees the two streams do not correlate.
  const aux = mulberry32((seed ^ 0x9e3779b9) | 0);

  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)] as T;
  const between = (lo: number, hi: number): number => lo + aux() * (hi - lo);

  const deals: Mt5Deal[] = [];
  let ticket = 1_000_000;

  // The opening deposit. MT5 reports it in the same history stream as trades, so carrying it
  // here keeps the mock honest about a shape the sync has to handle — and gives the balance
  // view something to show (SPEC §3.2).
  const depositAt = fromWallClock({ year: 2026, month: 5, day: 1, hour: 9, minute: 0 });
  deals.push({
    ticket: String(ticket++),
    kind: 'balance',
    symbol: '',
    direction: 'long',
    volume: 0,
    openAt: depositAt,
    closeAt: depositAt,
    entryPrice: 0,
    exitPrice: null,
    stopLoss: null,
    takeProfit: null,
    commission: 0,
    swap: 0,
    profit: MOCK_START_BALANCE,
  });

  const endDay = toDayNumber(END_DATE);

  for (let d = DAYS_BACK; d >= 0; d--) {
    const civil = fromDayNumber(endDay - d);
    // Markets are Monday–Friday.
    if (civil.weekday === 0 || civil.weekday === 6) continue;

    const count = Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const assetClass = pick(CLASSES);
      const symbol = pick(SYMBOLS[assetClass]!);

      const r = rnd();
      const hour =
        r < 0.2
          ? 3 + Math.floor(rnd() * 6)
          : r < 0.65
            ? 10 + Math.floor(rnd() * 6)
            : 16 + Math.floor(rnd() * 7);
      const minute = Math.floor(rnd() * 60);

      const style = rnd() < 0.72 ? 'day' : 'swing';

      let close: { civil: Civil; hour: number; minute: number };
      if (style === 'day') {
        const held = 15 + Math.floor(rnd() * 240);
        const total = hour * 60 + minute + held;
        close =
          total >= 24 * 60
            ? // The prototype clamps a day trade that would roll past midnight back to 23:55
              // on the same day, so "day trade" never spans two calendar squares.
              { civil, hour: 23, minute: 55 }
            : { civil, hour: Math.floor(total / 60), minute: total % 60 };
      } else {
        const heldDays = 1 + Math.floor(rnd() * 4);
        const closeHour = 9 + Math.floor(rnd() * 8);
        // setHours() in the prototype leaves the minute untouched, so it carries over.
        close = { civil: fromDayNumber(toDayNumber(civil) + heldDays), hour: closeHour, minute };
      }

      const direction = rnd() < 0.55 ? 'long' : 'short';

      // The prototype's hidden edge, so the analytics show patterns worth finding.
      let winProbability = 0.44;
      if (hour >= 10 && hour <= 15) winProbability += 0.12; // London hours
      if (civil.weekday === 2 || civil.weekday === 3) winProbability += 0.08; // Tue/Wed
      if (assetClass === 'crypto' && direction === 'short') winProbability += 0.06;
      if (assetClass === 'stocks') winProbability -= 0.04;

      const won = rnd() < winProbability;
      const targetRisk = Math.round(50 + rnd() * 150);
      const targetRr = won
        ? Number((0.7 + rnd() * 2.6).toFixed(2))
        : -Number((0.4 + rnd() * 0.7).toFixed(2));
      const targetNet = Math.round(targetRr * targetRisk);

      // --- everything below is production-only, and draws from `aux` ---

      const spec = findSymbolSpec(symbol) as SymbolSpec;
      const [lo, hi] = VOLUME_RANGE[spec.assetClass] ?? VOLUME_RANGE.other!;
      const volume =
        spec.assetClass === 'stocks'
          ? Math.max(1, Math.round(between(lo, hi)))
          : Math.max(0.01, round(between(lo, hi), 2));

      const entryPrice = round(BASE_PRICE[symbol]! * (1 + (aux() - 0.5) * 0.08), spec.digits);

      const priceContext = {
        spec,
        volume,
        entryPrice,
        accountCurrency: MOCK_ACCOUNT_CURRENCY,
        quoteRates: MOCK_QUOTE_RATES,
      };

      // Commission is charged per lot and reported negative, as MT5 does. Swap only accrues
      // on positions held overnight, which is exactly what makes a trade a swing trade.
      const commission = -round(volume * 3.5, 2);
      const swap = style === 'swing' ? -round(volume * 1.4 * (1 + aux()), 2) : 0;

      // Derived backwards through the sync's own formulas, so that computing risk and RR
      // forward from these prices lands back on targetRisk / targetRr.
      const stopDistance = stopDistanceForRisk(targetRisk, priceContext)!;
      const grossProfit = targetNet - commission - swap;
      const priceMove = priceMoveForProfit(grossProfit, priceContext)!;

      const sign = direction === 'long' ? 1 : -1;
      const stopLoss = round(entryPrice - sign * stopDistance, spec.digits);
      const takeProfit = round(entryPrice + sign * stopDistance * 2, spec.digits);
      const exitPrice = round(entryPrice + sign * priceMove, spec.digits);

      deals.push({
        ticket: String(ticket++),
        kind: 'trade',
        symbol,
        direction,
        volume,
        openAt: fromWallClock({ ...civil, hour, minute }),
        closeAt: fromWallClock({ ...close.civil, hour: close.hour, minute: close.minute }),
        entryPrice,
        exitPrice,
        stopLoss,
        takeProfit,
        commission,
        swap,
        profit: grossProfit,
      });
    }
  }

  deals.sort((a, b) => (a.closeAt?.getTime() ?? 0) - (b.closeAt?.getTime() ?? 0));

  return {
    deals,
    startBalance: MOCK_START_BALANCE,
    currency: MOCK_ACCOUNT_CURRENCY,
    quoteRates: MOCK_QUOTE_RATES,
  };
}
