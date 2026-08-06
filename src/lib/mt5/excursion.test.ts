import { describe, expect, it } from 'vitest';
import { computeExcursion, NO_EXCURSION, priceRangeDuring } from './excursion';
import type { SymbolSpec } from './symbols';
import type { Mt5Deal, PriceBar } from './types';

/** EURUSD on a USD account: contract size 100,000, quoted in the account currency. */
const SPEC: SymbolSpec = {
  symbol: 'EURUSD',
  assetClass: 'forex',
  contractSize: 100_000,
  baseCurrency: 'EUR',
  quoteCurrency: 'USD',
  digits: 5,
};

const bar = (at: string, low: number, high: number): PriceBar => ({
  at: new Date(at),
  open: (low + high) / 2,
  high,
  low,
  close: (low + high) / 2,
});

function deal(over: Partial<Mt5Deal> = {}): Mt5Deal {
  return {
    ticket: 'p1',
    kind: 'trade',
    symbol: 'EURUSD',
    direction: 'long',
    volume: 1,
    openAt: new Date('2026-07-01T10:00:00Z'),
    closeAt: new Date('2026-07-01T14:00:00Z'),
    entryPrice: 1.1,
    exitPrice: 1.12,
    stopLoss: 1.09,
    takeProfit: null,
    commission: 0,
    swap: 0,
    profit: 200,
    ...over,
  };
}

const context = { accountCurrency: 'USD', spec: SPEC };

describe('priceRangeDuring', () => {
  const bars = [
    bar('2026-07-01T09:00:00Z', 1.05, 1.06), // before the entry
    bar('2026-07-01T11:00:00Z', 1.08, 1.15),
    bar('2026-07-01T13:00:00Z', 1.09, 1.13),
    bar('2026-07-01T15:00:00Z', 1.2, 1.3), // after the exit
  ];

  it('ignores everything outside the trade’s own window', () => {
    // The failure this prevents: reporting price action that happened after the exit as if
    // the trade had lived through it, which makes every early close look worse than it was.
    const range = priceRangeDuring(bars, {
      from: new Date('2026-07-01T10:00:00Z'),
      to: new Date('2026-07-01T14:00:00Z'),
    });
    expect(range).toEqual({ low: 1.08, high: 1.15 });
  });

  it('includes the bars at both ends of the window', () => {
    const range = priceRangeDuring(bars, {
      from: new Date('2026-07-01T09:00:00Z'),
      to: new Date('2026-07-01T15:00:00Z'),
    });
    expect(range).toEqual({ low: 1.05, high: 1.3 });
  });

  it('is null when no bar falls inside', () => {
    expect(
      priceRangeDuring(bars, {
        from: new Date('2026-07-02T00:00:00Z'),
        to: new Date('2026-07-02T23:00:00Z'),
      }),
    ).toBeNull();
  });

  it('is null for no bars at all', () => {
    expect(priceRangeDuring([], { from: new Date(), to: new Date() })).toBeNull();
  });

  it('skips a bar with a non-finite extreme rather than poisoning the range', () => {
    const broken = [{ ...bar('2026-07-01T11:00:00Z', 1.08, 1.15), high: Number.NaN }];
    expect(
      priceRangeDuring(broken, {
        from: new Date('2026-07-01T10:00:00Z'),
        to: new Date('2026-07-01T14:00:00Z'),
      }),
    ).toBeNull();
  });
});

describe('computeExcursion', () => {
  const bars = [bar('2026-07-01T11:00:00Z', 1.08, 1.15), bar('2026-07-01T13:00:00Z', 1.09, 1.13)];

  it('measures a long from its entry: down to the low, up to the high', () => {
    // Entry 1.1, low 1.08 → 0.02 × 100,000 × 1 = $2,000 adverse.
    // Entry 1.1, high 1.15 → 0.05 × 100,000 × 1 = $5,000 favourable.
    const result = computeExcursion(deal(), bars, context);
    expect(result.mae).toBeCloseTo(2000, 6);
    expect(result.mfe).toBeCloseTo(5000, 6);
  });

  it('turns the two ends around for a short', () => {
    // The mistake this catches is invisible on a mostly-long book: a short suffers at the
    // high and profits at the low, so getting it backwards reports its drawdown as its run-up.
    const result = computeExcursion(deal({ direction: 'short' }), bars, context);
    expect(result.mae).toBeCloseTo(5000, 6);
    expect(result.mfe).toBeCloseTo(2000, 6);
  });

  it('scales with position size, like risk does', () => {
    const single = computeExcursion(deal(), bars, context);
    const triple = computeExcursion(deal({ volume: 3 }), bars, context);
    expect(triple.mae).toBeCloseTo(single.mae! * 3, 6);
    expect(triple.mfe).toBeCloseTo(single.mfe! * 3, 6);
  });

  it('is comparable with the risk figure, which is the point of using money', () => {
    // Stop at 1.09 is 0.01 away — $1,000 of risk. The trade's MAE of $2,000 means it went
    // through where the stop was, which is a fact a trader wants shouted at them.
    const result = computeExcursion(deal(), bars, context);
    expect(result.mae! / 1000).toBeCloseTo(2, 6);
  });

  it('reports zero, not null, for a trade that never went against the entry', () => {
    // Zero is an answer — "it went straight to profit". Null means "we do not know", and the
    // aggregates treat the two differently on purpose.
    const rising = [bar('2026-07-01T11:00:00Z', 1.1, 1.2)];
    const result = computeExcursion(deal(), rising, context);
    expect(result.mae).toBe(0);
    expect(result.mfe).toBeCloseTo(10_000, 6);
  });

  it('clamps at the entry rather than reporting a negative excursion', () => {
    // Every bar sits above a long's entry: the adverse move is zero, not a profit.
    const above = [bar('2026-07-01T11:00:00Z', 1.12, 1.2)];
    expect(computeExcursion(deal(), above, context).mae).toBe(0);
  });

  it('is unknown when there is no price history', () => {
    expect(computeExcursion(deal(), [], context)).toEqual(NO_EXCURSION);
  });

  it('is unknown for a symbol with no contract specification', () => {
    // Same rule as risk: a contract size we would have to guess at is one we do not report.
    const result = computeExcursion(deal({ symbol: 'WHAT' }), bars, {
      accountCurrency: 'USD',
      spec: null,
    });
    expect(result).toEqual(NO_EXCURSION);
  });

  it('is unknown for a currency that cannot be converted', () => {
    const eurQuoted: SymbolSpec = { ...SPEC, symbol: 'GER40', quoteCurrency: 'EUR', baseCurrency: 'EUR' };
    const result = computeExcursion(deal({ symbol: 'GER40' }), bars, {
      accountCurrency: 'USD',
      spec: eurQuoted,
    });
    expect(result).toEqual(NO_EXCURSION);
  });

  it('converts through a supplied rate when the symbol is quoted in a third currency', () => {
    const eurQuoted: SymbolSpec = {
      symbol: 'GER40',
      assetClass: 'indices',
      contractSize: 1,
      baseCurrency: 'EUR',
      quoteCurrency: 'EUR',
      digits: 2,
    };
    const result = computeExcursion(deal({ symbol: 'GER40' }), bars, {
      accountCurrency: 'USD',
      spec: eurQuoted,
      quoteRates: { EURUSD: 2 },
    });
    // 0.02 × 1 × 1 × 2 = 0.04
    expect(result.mae).toBeCloseTo(0.04, 8);
  });

  it('says nothing about an open position', () => {
    expect(computeExcursion(deal({ closeAt: null }), bars, context)).toEqual(NO_EXCURSION);
  });

  it('says nothing about a deposit', () => {
    expect(computeExcursion(deal({ kind: 'balance' }), bars, context)).toEqual(NO_EXCURSION);
  });

  it('never reports an MFE smaller than the realised move it contains', () => {
    // A property rather than a case: the best price reached is at least as good as the price
    // taken, so MFE cannot be less than the profit expressed the same way.
    const result = computeExcursion(deal(), bars, context);
    const realised = (1.12 - 1.1) * 100_000;
    expect(result.mfe!).toBeGreaterThanOrEqual(realised);
  });
});
