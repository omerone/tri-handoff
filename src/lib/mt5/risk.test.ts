import { describe, expect, it } from 'vitest';
import { computeRisk, computeRr, netProfit, stopDistanceForRisk } from './risk';
import { findSymbolSpec } from './symbols';
import type { Mt5Deal } from './types';

/**
 * RR is the client's headline metric (SPEC §3.5), and it is the one number in the product a
 * trader would change their behaviour over. Every case where it must refuse to produce a
 * number is tested, because the failure mode is not a crash — it is a plausible figure
 * computed from a guessed contract size, which nobody would question.
 */

const deal = (overrides: Partial<Mt5Deal> = {}): Mt5Deal => ({
  ticket: '1',
  kind: 'trade',
  symbol: 'EURUSD',
  direction: 'long',
  volume: 1,
  openAt: new Date('2026-07-01T10:00:00Z'),
  closeAt: new Date('2026-07-01T12:00:00Z'),
  entryPrice: 1.1,
  exitPrice: 1.11,
  stopLoss: 1.09,
  takeProfit: 1.13,
  commission: 0,
  swap: 0,
  profit: 0,
  ...overrides,
});

describe('computeRisk', () => {
  it('is |entry − sl| × contract size × volume for a pair quoted in the account currency', () => {
    // 100 pips on one lot of EURUSD is 1,000 dollars — the textbook figure.
    const result = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.09,
      accountCurrency: 'USD',
      direction: 'long',
    });
    expect(result.risk).toBeCloseTo(1000, 6);
  });

  it('scales with volume', () => {
    const base = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.09,
      accountCurrency: 'USD',
      direction: 'long',
    }).risk!;
    const tenth = computeRisk({
      symbol: 'EURUSD',
      volume: 0.1,
      entryPrice: 1.1,
      stopLoss: 1.09,
      accountCurrency: 'USD',
      direction: 'long',
    }).risk!;
    expect(tenth).toBeCloseTo(base / 10, 6);
  });

  it('uses the real contract size, not one unit per lot', () => {
    // Gold is 100 ounces to the lot: a $10 move on one lot is $1,000, not $10.
    const gold = computeRisk({
      symbol: 'XAUUSD',
      volume: 1,
      entryPrice: 2350,
      stopLoss: 2340,
      accountCurrency: 'USD',
      direction: 'long',
    });
    expect(gold.risk).toBeCloseTo(1000, 6);
  });

  it('is symmetric — a short with the stop above the entry risks the same', () => {
    const long = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.09,
      accountCurrency: 'USD',
      direction: 'long',
    });
    const short = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.11,
      accountCurrency: 'USD',
      direction: 'short',
    });
    expect(short.risk).toBeCloseTo(long.risk!, 6);
  });

  describe('currency conversion', () => {
    it('converts a pair quoted in a third currency using the account rate', () => {
      // GER40 is quoted in euros; 100 points on one contract is €100 = $108.
      const result = computeRisk({
        direction: 'long',
        symbol: 'GER40',
        volume: 1,
        entryPrice: 18_500,
        stopLoss: 18_400,
        accountCurrency: 'USD',
        quoteRates: { EURUSD: 1.08 },
      });
      expect(result.risk).toBeCloseTo(108, 6);
    });

    it('accepts the rate quoted the other way round', () => {
      const direct = computeRisk({
        direction: 'long',
        symbol: 'GER40',
        volume: 1,
        entryPrice: 18_500,
        stopLoss: 18_400,
        accountCurrency: 'USD',
        quoteRates: { EURUSD: 1.08 },
      });
      const inverse = computeRisk({
        direction: 'long',
        symbol: 'GER40',
        volume: 1,
        entryPrice: 18_500,
        stopLoss: 18_400,
        accountCurrency: 'USD',
        quoteRates: { USDEUR: 1 / 1.08 },
      });
      expect(inverse.risk).toBeCloseTo(direct.risk!, 6);
    });

    it('derives the rate from the price itself when the account currency is the base', () => {
      // USDJPY on a dollar account: 1 yen is 1/price dollars, no external rate needed.
      // 1.00 yen of stop on one lot = 100,000 yen ÷ 152 = $657.89.
      const result = computeRisk({
        symbol: 'USDJPY',
        volume: 1,
        entryPrice: 152,
        stopLoss: 151,
        accountCurrency: 'USD',
        direction: 'long',
    });
      expect(result.risk).toBeCloseTo(100_000 / 152, 4);
    });

    it('refuses rather than guessing when the quote currency cannot be converted', () => {
      const result = computeRisk({
        symbol: 'GER40',
        volume: 1,
        entryPrice: 18_500,
        stopLoss: 18_400,
        accountCurrency: 'USD',
        direction: 'long',
    });
      expect(result).toEqual({ risk: null, reason: 'unconvertible' });
    });
  });

  describe('refusals', () => {
    it('has no risk without a stop loss', () => {
      expect(
        computeRisk({
        direction: 'long',
          symbol: 'EURUSD',
          volume: 1,
          entryPrice: 1.1,
          stopLoss: null,
          accountCurrency: 'USD',
        }),
      ).toEqual({ risk: null, reason: 'no-stop-loss' });
    });

    it('has no risk when the stop sits on the entry', () => {
      expect(
        computeRisk({
          symbol: 'EURUSD',
          volume: 1,
          entryPrice: 1.1,
          stopLoss: 1.1,
          accountCurrency: 'USD',
          direction: 'long',
    }).reason,
      ).toBe('zero-distance');
    });

    it('has no risk for a symbol with no contract specification', () => {
      // The dangerous case: assuming one unit per lot would produce a number ~100,000 times
      // too small for an FX pair, and it would look perfectly reasonable on the dashboard.
      expect(
        computeRisk({
          symbol: 'WHOKNOWS',
          volume: 1,
          entryPrice: 100,
          stopLoss: 99,
          accountCurrency: 'USD',
          direction: 'long',
    }),
      ).toEqual({ risk: null, reason: 'unknown-symbol' });
    });

    it('has no risk on zero volume', () => {
      expect(
        computeRisk({
          symbol: 'EURUSD',
          volume: 0,
          entryPrice: 1.1,
          stopLoss: 1.09,
          accountCurrency: 'USD',
          direction: 'long',
    }).risk,
      ).toBeNull();
    });

    it('ignores a non-finite stop loss', () => {
      expect(
        computeRisk({
        direction: 'long',
          symbol: 'EURUSD',
          volume: 1,
          entryPrice: 1.1,
          stopLoss: Number.NaN,
          accountCurrency: 'USD',
        }).reason,
      ).toBe('no-stop-loss');
    });
  });
});

describe('netProfit', () => {
  it('applies commission and swap, which MT5 reports as negative', () => {
    expect(netProfit({ profit: 100, commission: -7, swap: -3 })).toBe(90);
  });

  it('is the raw profit when there are no charges', () => {
    expect(netProfit({ profit: 100, commission: 0, swap: 0 })).toBe(100);
  });
});

describe('computeRr', () => {
  it('is net profit over risk', () => {
    const result = computeRr(deal({ profit: 2000, commission: 0, swap: 0 }), {
      accountCurrency: 'USD',
    });
    expect(result.risk).toBeCloseTo(1000, 6);
    expect(result.rr).toBeCloseTo(2, 6);
  });

  it('measures the money that actually moved, not the gross', () => {
    // A 2R gross trade that paid $100 in costs is a 1.9R trade.
    const result = computeRr(deal({ profit: 2000, commission: -70, swap: -30 }), {
      accountCurrency: 'USD',
    });
    expect(result.rr).toBeCloseTo(1.9, 6);
  });

  it('is negative on a loser', () => {
    const result = computeRr(deal({ profit: -1000 }), { accountCurrency: 'USD' });
    expect(result.rr).toBeCloseTo(-1, 6);
  });

  it('is null — never zero — when there is no stop loss', () => {
    const result = computeRr(deal({ stopLoss: null, profit: 500 }), { accountCurrency: 'USD' });
    // Zero here would drag every average toward the middle and quietly understate a good
    // month; null excludes the trade and shows up as reduced RR coverage instead.
    expect(result.rr).toBeNull();
    expect(result.risk).toBeNull();
    expect(result.reason).toBe('no-stop-loss');
  });

  it('accepts a broker-supplied spec in place of the built-in table', () => {
    const result = computeRr(deal({ symbol: 'UNKNOWN.X', profit: 1000 }), {
      accountCurrency: 'USD',
      spec: {
        symbol: 'UNKNOWN.X',
        assetClass: 'indices',
        contractSize: 10,
        quoteCurrency: 'USD',
        digits: 2,
      },
    });
    // |1.10 − 1.09| × 10 × 1 = 0.1
    expect(result.risk).toBeCloseTo(0.1, 6);
  });
});

describe('stopDistanceForRisk', () => {
  it('inverts computeRisk exactly', () => {
    const spec = findSymbolSpec('EURUSD')!;
    const distance = stopDistanceForRisk(750, {
      spec,
      volume: 0.3,
      entryPrice: 1.1,
      accountCurrency: 'USD',
    })!;

    const round = computeRisk({
      symbol: 'EURUSD',
      volume: 0.3,
      entryPrice: 1.1,
      stopLoss: 1.1 - distance,
      accountCurrency: 'USD',
      direction: 'long',
    });
    expect(round.risk).toBeCloseTo(750, 6);
  });

  it('inverts it through a currency conversion too', () => {
    const spec = findSymbolSpec('GER40')!;
    const quoteRates = { EURUSD: 1.08 };
    const distance = stopDistanceForRisk(500, {
      spec,
      volume: 2,
      entryPrice: 18_500,
      accountCurrency: 'USD',
      quoteRates,
    })!;

    const round = computeRisk({
      symbol: 'GER40',
      volume: 2,
      entryPrice: 18_500,
      stopLoss: 18_500 - distance,
      accountCurrency: 'USD',
      quoteRates,
      direction: 'long',
    });
    expect(round.risk).toBeCloseTo(500, 6);
  });

  it('returns null when the conversion is unknown', () => {
    expect(
      stopDistanceForRisk(500, {
        spec: findSymbolSpec('GER40')!,
        volume: 1,
        entryPrice: 18_500,
        accountCurrency: 'USD',
      }),
    ).toBeNull();
  });
});

describe('a stop on the wrong side of the entry', () => {
  /**
   * The trade that produced this rule, with its real numbers.
   *
   * A long on USOIL entered at 69.298 and closed for $854.62, with the stop trailed up to
   * 69.303 — five thousandths *above* the entry. Read as an absolute distance that is a risk
   * of four dollars and an RR of 213.66. It was the only one of forty-eight trades carrying a
   * stop at all, so 213.66R was the figure the whole account was reported at, on screen, to a
   * client.
   */
  const usoil = () =>
    deal({
      symbol: 'USOIL',
      direction: 'long',
      volume: 0.8,
      entryPrice: 69.298,
      stopLoss: 69.303,
      exitPrice: 70.37,
      profit: 854.62,
      commission: 0,
      swap: 0,
    });

  it('is not a risk, and yields no RR', () => {
    const result = computeRr(usoil(), { accountCurrency: 'USD' });

    expect(result.risk).toBeNull();
    expect(result.rr).toBeNull();
    expect(result.reason).toBe('stop-beyond-entry');
  });

  it('is reported as its own reason, so coverage can say why', () => {
    // Distinct from 'no-stop-loss': the trader did set a stop. Collapsing the two would tell
    // them to start using stops on a trade where they used one and moved it to breakeven.
    const short = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.09,
      direction: 'short',
      accountCurrency: 'USD',
    });
    expect(short.reason).toBe('stop-beyond-entry');
  });

  it('still measures a stop that sits on the losing side, however close', () => {
    // Not a threshold rule: a two-pip stop is a small risk, not an absent one, and inventing a
    // minimum would quietly delete the tightest trades from the RR average.
    const tight = computeRisk({
      symbol: 'EURUSD',
      volume: 1,
      entryPrice: 1.1,
      stopLoss: 1.0998,
      direction: 'long',
      accountCurrency: 'USD',
    });
    expect(tight.risk).toBeCloseTo(20, 6);
  });

  it('treats an exact breakeven stop as zero distance rather than a negative one', () => {
    for (const direction of ['long', 'short'] as const) {
      const result = computeRisk({
        symbol: 'EURUSD',
        volume: 1,
        entryPrice: 1.1,
        stopLoss: 1.1,
        direction,
        accountCurrency: 'USD',
      });
      expect(result.risk).toBeNull();
      expect(result.reason).toBe('zero-distance');
    }
  });
});
