import { describe, expect, it } from 'vitest';
import { computeRisk, computeRr, explainMissingRr, netProfit, stopDistanceForRisk } from './risk';
import { merge } from './sync';
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

/**
 * The bug a client found: risk and R missing on almost every trade, while the stop loss sat on
 * screen two rows below the dash explaining that there was no stop loss.
 *
 * Three separate causes, all reproduced here against the real production shapes. The first is
 * the one worth remembering, because better data made the answer worse: the broker override
 * was read from a field MetaApi does not have, arrived with no currency, replaced a static
 * spec that worked, and turned every trade on the account `unconvertible`. When the same call
 * 404'd, risk came out fine.
 */
describe('the missing-R bug', () => {
  it('keeps the static currency when the broker sends none', () => {
    // What `fetchSymbolSpecs` produced while it read a field that does not exist.
    const spec = merge({ symbol: 'GBPUSD', contractSize: 100_000, quoteCurrency: '', digits: 5 });
    expect(spec?.quoteCurrency, 'an empty override currency displaced a known-good one').toBe(
      'USD',
    );

    const risk = computeRisk({
      symbol: 'GBPUSD',
      volume: 2,
      entryPrice: 1.34057,
      stopLoss: 1.34111,
      direction: 'short',
      accountCurrency: 'USD',
      spec,
    });
    expect(risk.risk).toBeCloseTo(108, 2);
  });

  it('reads a currency the broker shouted or padded as the same currency', () => {
    // Same hole, reachable a second way: `usd` is not a different currency from `USD`, and an
    // override that says so displaces the static value and makes the account unconvertible
    // again — with the field populated this time, so it looks like it worked.
    const spec = merge({
      symbol: 'GBPUSD',
      contractSize: 100_000,
      quoteCurrency: ' usd ',
      digits: 5,
    });
    expect(spec?.quoteCurrency).toBe('USD');
  });

  it('still lets the broker correct the numbers it is authoritative on', () => {
    // The whole reason the override exists: contract size varies per broker.
    const spec = merge({ symbol: 'GBPUSD', contractSize: 10_000, quoteCurrency: 'USD', digits: 5 });
    expect(spec?.contractSize).toBe(10_000);
  });

  it('refuses a spec nobody can supply a contract size for', () => {
    /*
     * The tempting default here is 1, and it is the worse answer by a hundred thousand.
     *
     * A symbol absent from the static table, on a broker that sent no contract size, has no
     * honest lot value anywhere. A spec claiming 1 produces a real risk figure with no reason
     * attached — USDMXN would come out at half a cent instead of $588 and land in the average
     * R and the coverage percentage as a good number. No spec means no R, which is visible.
     */
    expect(
      merge({ symbol: 'USDMXN', contractSize: 0, quoteCurrency: 'MXN', digits: 5 }),
    ).toBeNull();
    // Known symbol, so the table still answers even though the broker did not.
    expect(
      merge({ symbol: 'GBPUSD', contractSize: 0, quoteCurrency: 'USD', digits: 5 }),
    ).toMatchObject({
      contractSize: 100_000,
    });
  });

  it('prices a currency pair the classifier does not recognise as one', () => {
    /*
     * The gap the first version of the index guard opened, and it opened it onto the exact
     * symptom this file is about.
     *
     * `classifySymbol` calls a great many real pairs `other`: every exotic whose second
     * currency is missing from its list, and every broker suffix written without a separator —
     * `EURUSDm`, `USDCADz`, the naming family that made this bug hard to see to begin with.
     * Keying the `1/price` shortcut on `assetClass === 'forex'` refused all of them, and the
     * sync had already decided not to fetch a rate for them on the other half of the same
     * condition. Neither path, so `unconvertible`: a stop printed on the card and no R beside
     * it, which is what the client wrote in about.
     */
    const spec = merge({
      symbol: 'USDSEK',
      contractSize: 100_000,
      quoteCurrency: 'SEK',
      baseCurrency: 'USD',
      digits: 5,
    });
    expect(spec?.assetClass, 'the premise of this test has changed').toBe('other');

    const risk = computeRisk({
      symbol: 'USDSEK',
      volume: 1,
      entryPrice: 10,
      stopLoss: 9.9,
      direction: 'long',
      accountCurrency: 'USD',
      spec,
    });
    // 0.1 SEK per unit × 100,000 units, converted at the price itself: 10,000 SEK = $1,000.
    expect(risk.risk).toBeCloseTo(1_000, 6);
  });

  it('says the stop risks nothing before it says it cannot price the instrument', () => {
    /*
     * Which of two true refusals the reader is given.
     *
     * Whether a stop risks anything is a fact about the trade — entry, stop, side — and needs
     * no contract size. Checking the spec first meant a trader who moved their stop to
     * breakeven on a symbol outside the built-in table was told the instrument could not be
     * priced and that it was worth reporting. The most common harmless thing a trader does,
     * answered with a support ticket.
     */
    const trailed = {
      symbol: 'EURJPY', // A real pair, deliberately absent from the static table.
      volume: 1,
      entryPrice: 160,
      stopLoss: 161,
      direction: 'long' as const,
      accountCurrency: 'USD',
    };
    expect(findSymbolSpec(trailed.symbol), 'the premise of this test has changed').toBeNull();
    expect(computeRisk(trailed).reason).toBe('stop-beyond-entry');
    expect(explainMissingRr(trailed, 'USD')).toBe('stop-beyond-entry');
  });

  it('separates having no size from having no distance', () => {
    // Both used to answer `zero-distance`, whose message says the stop sat on the entry — on a
    // card printing an entry of 5,000 and a stop of 4,980 two rows below.
    const sized = {
      symbol: 'EURUSD',
      entryPrice: 1.1,
      stopLoss: 1.09,
      direction: 'long' as const,
      accountCurrency: 'USD',
    };
    expect(computeRisk({ ...sized, volume: 0 }).reason).toBe('no-volume');
    expect(computeRisk({ ...sized, stopLoss: 1.1, volume: 1 }).reason).toBe('zero-distance');
  });

  it('refuses a stop that sits inside the spread', () => {
    /*
     * The three trades that would have made the client's average R meaningless.
     *
     * A broker stores the stop the trade *ended* with, so a position that ran well records the
     * level the stop was trailed to. Cross the entry and `stop-beyond-entry` catches it; stop a
     * tenth of a pip short and every check passes, the risk comes out at a dollar, and a $283
     * win reads 189R. Three rows like this took the average of forty-one from a median of
     * −1.13R to a mean of +10.22R.
     *
     * These are the real production values, to the tick.
     */
    const trailed = [
      { symbol: 'GBPUSD', entryPrice: 1.34156, stopLoss: 1.34155, volume: 1 },
      { symbol: 'EURUSD', entryPrice: 1.16918, stopLoss: 1.16916, volume: 1 },
    ];
    for (const trade of trailed) {
      expect(
        computeRisk({ ...trade, direction: 'long', accountCurrency: 'USD' }).reason,
        `${trade.symbol} priced a stop one tick from the entry`,
      ).toBe('zero-distance');
    }

    // And the smallest stop the same book actually contains, which has to survive: 22 ticks.
    const real = computeRisk({
      symbol: 'GBPUSD',
      entryPrice: 1.34156,
      stopLoss: 1.33936,
      volume: 1,
      direction: 'long',
      accountCurrency: 'USD',
    });
    expect(real.risk, 'the guard swallowed a genuine stop').toBeCloseTo(220, 6);
  });

  it('measures that closeness against the price, not against the tick', () => {
    /*
     * The first version of the guard was ten ticks of the instrument's own resolution, which
     * is a pip on a five-digit pair and nonsense anywhere the tick is coarse next to the
     * price. On something quoted to two decimals and trading at 1.10 it is nine percent — it
     * refused every real stop on the instrument, and two existing tests said so.
     */
    const result = computeRisk({
      symbol: 'UNKNOWN.X',
      entryPrice: 1.1,
      stopLoss: 1.09,
      volume: 1,
      direction: 'long',
      accountCurrency: 'USD',
      spec: {
        symbol: 'UNKNOWN.X',
        assetClass: 'indices',
        contractSize: 10,
        quoteCurrency: 'USD',
        digits: 2,
      },
    });
    expect(result.risk).toBeCloseTo(0.1, 6);
  });

  it('does not divide an index by its own price', () => {
    /*
     * MetaApi marks `baseCurrency` required, so it names one for every instrument — including
     * indices, where it is USD. `1/price` is the rate only when the contract size counts units
     * of the base currency, which is a fact about currency pairs and about nothing else.
     *
     * Unguarded, an S&P position at 5000 with a ten-dollar risk reported two tenths of a cent,
     * `reason: null`, straight into the averages. A refusal would have been better; a correct
     * answer is better still, and that is what the quote currency gives here.
     */
    const spec = merge({
      symbol: 'SPX500',
      contractSize: 1,
      quoteCurrency: 'USD',
      baseCurrency: 'USD',
      digits: 1,
    });
    const risk = computeRisk({
      symbol: 'SPX500',
      volume: 1,
      entryPrice: 5000,
      stopLoss: 4990,
      direction: 'long',
      accountCurrency: 'USD',
      spec,
    });
    expect(risk.risk, 'the index was priced as if it were a currency pair').toBeCloseTo(10, 6);
  });

  it('prices the symbols this broker actually sends', () => {
    // US100 is NAS100 under another house's name, and USDCAD was simply absent. Four live
    // trades apiece came out with no risk and the screen blamed a missing stop.
    for (const symbol of ['US100', 'USTEC', 'USDCAD', 'NAS100']) {
      expect(findSymbolSpec(symbol), `${symbol} has no contract size`).not.toBeNull();
    }
  });

  it('says which reason it was, rather than always the same one', () => {
    const base = { symbol: 'GBPUSD', direction: 'long' as const, entryPrice: 1.3, volume: 1 };
    const why = (over: Partial<typeof base> & { stopLoss: number | null }) =>
      explainMissingRr({ ...base, ...over }, 'USD');

    expect(why({ stopLoss: null })).toBe('no-stop-loss');
    // A stop moved past the entry: nothing at risk, and correctly no R.
    expect(why({ stopLoss: 1.31 })).toBe('stop-beyond-entry');
    // Exactly on the entry — breakeven, which is a different sentence to the reader.
    expect(why({ stopLoss: 1.3 })).toBe('zero-distance');
    expect(why({ symbol: 'WHEATX', stopLoss: 1.29 })).toBe('unknown-symbol');
    expect(why({ symbol: 'GER40', stopLoss: 1.29 })).toBe('unconvertible');
  });

  it('does not invent a reason for a row that prices perfectly well', () => {
    /*
     * The 37 trades this nearly got wrong.
     *
     * Production had a batch with valid stops on USD-quoted pairs and no stored risk — rows
     * left behind by a disconnect, which no re-sync can reach. Walking the checks by hand fell
     * through to the last one and told the trader their instrument was priced in a currency
     * the account does not hold. GBPUSD on a dollar account: confidently, specifically wrong.
     *
     * Nothing on the row explains the missing number, so the answer has to say that.
     */
    expect(
      explainMissingRr(
        { symbol: 'GBPUSD', direction: 'short', entryPrice: 1.34361, stopLoss: 1.34434, volume: 5 },
        'USD',
      ),
    ).toBe('stale');
  });
});
