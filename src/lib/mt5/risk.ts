import { findSymbolSpec, type SymbolSpec } from './symbols';
import type { Direction, Mt5Deal } from './types';

/**
 * RISK AND RR — the rule, in one place.
 *
 *   risk = (entry price − stop loss, on the losing side) × contract size × volume × rate
 *   rr   = net profit / risk
 *
 * where net profit is the broker's `profit` with commission and swap already applied, since
 * that is the money that actually moved.
 *
 * **The stop has a side, not just a distance.** A long's stop sits *below* its entry and a
 * short's *above* it; that is what makes it a stop. A stop on the other side is not a small
 * risk, it is no risk — the position could not lose from there, because the exit was already
 * in profit. Measuring it as `|entry − stop|` was this file's original mistake and it does
 * not produce a slightly wrong number, it produces a spectacular one: a real trade in this
 * journal was a long on USOIL entered at 69.298 whose stop had been trailed up to 69.303, and
 * the absolute distance of half a cent turned $854 of profit into **213.66R**. That trade was
 * the only one of forty-eight carrying a stop at all, so 213.66R was the R the whole account
 * was reported at.
 *
 * **When there is no RR.** `rr` is null — not zero, not omitted quietly — whenever any input
 * is missing or nonsensical:
 *
 *   - the position carried no stop loss, so there was no defined risk to measure against;
 *   - the stop loss sat exactly at the entry, giving zero risk and an infinite ratio;
 *   - the stop had been moved past the entry, locking in profit rather than defining a loss;
 *   - the symbol has no contract specification, so "contract size" would be a guess;
 *   - the symbol is quoted in a currency we cannot convert to the account currency.
 *
 * A null `rr` is excluded from every RR aggregate, and the proportion of trades that have one
 * is surfaced in the UI as RR coverage. This matters more than it looks: RR is the client's
 * headline metric (SPEC §3.5), and silently treating a stop-less trade as `0R` would drag the
 * average toward zero and make a good month look mediocre — while silently dropping it with
 * no coverage figure would let an average computed from three trades masquerade as one
 * computed from three hundred.
 */

export type RiskInputs = {
  symbol: string;
  volume: number;
  entryPrice: number;
  stopLoss: number | null;
  /**
   * Which way the position faced — required, because it is what decides whether the stop is
   * below the entry or above it, and therefore whether it defines a loss at all.
   */
  direction: Direction;
  /** Currency the account is denominated in — what risk must be expressed in. */
  accountCurrency: string;
  /**
   * Rate converting the symbol's quote currency into the account currency, when the two
   * differ and the conversion is not implied by the symbol itself. Keyed `"<quote><account>"`.
   */
  quoteRates?: Record<string, number>;
  /** Broker-supplied spec, which wins over the static table. */
  spec?: SymbolSpec | null;
};

export type RiskResult =
  | { risk: number; reason: null }
  | {
      risk: null;
      reason:
        | 'no-stop-loss'
        /** The stop and the entry were the same price: a distance of zero risks nothing. */
        | 'zero-distance'
        /** No position size, so no money behind the distance. Usually a hand-entered trade. */
        | 'no-volume'
        /** The stop was past the entry: the exit was in profit, so nothing was at risk. */
        | 'stop-beyond-entry'
        | 'unknown-symbol'
        | 'unconvertible';
    };

/**
 * Whether the price itself is the exchange rate — the account currency is what this contract
 * is *sized in*, so one unit of the quote currency is `1/price` of it.
 *
 * Exported because two places have to agree on it and did not. `computeRisk` uses it to take
 * the shortcut, and `fetchQuoteRates` in sync.ts uses it to decide there is no rate worth
 * asking the broker for. When the two conditions differed, symbols in the gap got neither: no
 * rate was fetched *and* no shortcut applied, and every one of them came out `unconvertible` —
 * the client's original symptom, reintroduced by the guard that was meant to prevent a
 * different version of it.
 *
 * The test is "not an index", not "is forex", and the difference is the whole point. `1/price`
 * follows from the contract size counting units of the base currency: true of a currency pair,
 * true of a hundred ounces of gold or one bitcoin, and false of an index, where a contract is
 * one index point and the base currency the broker reports is an artefact. `classifySymbol`
 * calls a great many real currency pairs `other` — every exotic whose second currency is not in
 * its list, and every broker suffix written without a separator, `EURUSDm` and `USDCADz` among
 * them — so keying on `forex` quietly refused to price the exact family of names that made
 * this bug hard to see in the first place. Metals and crypto name a base that is not a currency
 * any account is denominated in, so admitting them costs nothing.
 */
export function baseImpliesRate(spec: SymbolSpec, accountCurrency: string): boolean {
  return (
    spec.assetClass !== 'indices' &&
    spec.baseCurrency !== undefined &&
    spec.baseCurrency === accountCurrency.toUpperCase()
  );
}

/**
 * Converts one unit of the symbol's quote currency into the account currency.
 *
 * Three cases, in order of confidence:
 *   1. already the account currency → 1;
 *   2. the account currency is the *base* of this very pair (USDJPY on a USD account) → the
 *      price itself is the rate, so one JPY is 1/price dollars. No external data needed, and
 *      it is exact for the moment of the trade;
 *   3. anything else → an explicitly supplied rate, or nothing.
 *
 * Case 2 is `baseImpliesRate` below, and the condition there is load-bearing rather than tidy.
 */
function quoteToAccountRate(
  spec: SymbolSpec,
  entryPrice: number,
  accountCurrency: string,
  quoteRates: Record<string, number> | undefined,
): number | null {
  const account = accountCurrency.toUpperCase();
  if (spec.quoteCurrency === account) return 1;

  if (baseImpliesRate(spec, account) && entryPrice > 0) return 1 / entryPrice;

  const direct = quoteRates?.[`${spec.quoteCurrency}${account}`];
  if (typeof direct === 'number' && direct > 0) return direct;

  const inverse = quoteRates?.[`${account}${spec.quoteCurrency}`];
  if (typeof inverse === 'number' && inverse > 0) return 1 / inverse;

  return null;
}

export function computeRisk(inputs: RiskInputs): RiskResult {
  if (inputs.stopLoss === null || !Number.isFinite(inputs.stopLoss)) {
    return { risk: null, reason: 'no-stop-loss' };
  }

  /*
   * The trade first, the instrument second — the order matters to what the user is told.
   *
   * Whether a stop risks anything is a fact about the trade: the entry, the stop and the side.
   * None of it needs a contract size. Asking for the spec first meant a trader who moved their
   * stop to breakeven on a symbol outside the built-in table — EURJPY, or any name carrying a
   * broker suffix — was told the instrument could not be priced and that it was worth
   * reporting, when the truth was that they had taken their own risk off. The reason a person
   * reads has to be the most fundamental one that applies, not the first one the code happens
   * to reach.
   *
   * Signed by the side the position faced: a long loses as the price falls, so its stop must
   * be below the entry, and a short's above.
   */
  const distance =
    inputs.direction === 'long'
      ? inputs.entryPrice - inputs.stopLoss
      : inputs.stopLoss - inputs.entryPrice;

  if (!(inputs.volume > 0)) return { risk: null, reason: 'no-volume' };
  if (distance === 0) return { risk: null, reason: 'zero-distance' };
  if (!(distance > 0)) return { risk: null, reason: 'stop-beyond-entry' };

  const spec = inputs.spec ?? findSymbolSpec(inputs.symbol);
  if (!spec) return { risk: null, reason: 'unknown-symbol' };

  /*
   * A stop inside the spread is not a stop, it is breakeven recorded a hair short of it — the
   * same event as `stop-beyond-entry`, caught on the wrong side of the line.
   *
   * The broker stores the *final* stop, not the one the trade opened with, so what lands in
   * this column on a trade that went well is a stop trailed up to lock the profit in. The
   * docstring at the top of this file describes the version that crosses the entry and reads
   * 213.66R. The version that stops a tenth of a pip short is the same absurdity and passes
   * every check above it: three trades in the client's book had stops one and two ticks out,
   * priced at a dollar of risk apiece, and read 189R, 162R and 104R. Three rows out of
   * forty-one moved the average from a median of −1.13R to a mean of +10.22R.
   *
   * A basis point of the entry price, and it is a fact about dealing rather than a number that
   * happened to work: one basis point of GBPUSD is 1.3 pips, which is a normal spread, so a
   * stop that close could not have been placed and survived to be recorded. It is relative to
   * the price on purpose — ten ticks of the instrument's own resolution was the first version
   * of this and it is only meaningful while ticks are fine next to the price. On something
   * quoted to two decimals and trading at 1.10, ten ticks is nine percent, and it would have
   * refused every genuine stop on the instrument.
   *
   * The line is drawn through an empty gap rather than through the data: production has three
   * stops at 0.07–0.17 basis points and then nothing until 1.6.
   */
  if (!(inputs.entryPrice > 0)) return { risk: null, reason: 'zero-distance' };
  if (distance / inputs.entryPrice < 0.0001) return { risk: null, reason: 'zero-distance' };

  const rate = quoteToAccountRate(
    spec,
    inputs.entryPrice,
    inputs.accountCurrency,
    inputs.quoteRates,
  );
  if (rate === null) return { risk: null, reason: 'unconvertible' };

  const risk = distance * spec.contractSize * inputs.volume * rate;
  if (!Number.isFinite(risk) || risk <= 0) return { risk: null, reason: 'zero-distance' };

  return { risk, reason: null };
}

/** Net result of a deal: what the balance actually moved by. */
export function netProfit(deal: Pick<Mt5Deal, 'profit' | 'commission' | 'swap'>): number {
  return deal.profit + deal.commission + deal.swap;
}

export type RrResult = {
  risk: number | null;
  rr: number | null;
  /** Why there is no RR, for the coverage tooltip. Null when there is one. */
  reason: RiskResult['reason'];
};

export function computeRr(
  deal: Mt5Deal,
  context: {
    accountCurrency: string;
    quoteRates?: Record<string, number>;
    spec?: SymbolSpec | null;
  },
): RrResult {
  const result = computeRisk({
    symbol: deal.symbol,
    volume: deal.volume,
    entryPrice: deal.entryPrice,
    stopLoss: deal.stopLoss,
    direction: deal.direction,
    accountCurrency: context.accountCurrency,
    quoteRates: context.quoteRates,
    spec: context.spec,
  });

  if (result.risk === null) return { risk: null, rr: null, reason: result.reason };
  return { risk: result.risk, rr: netProfit(deal) / result.risk, reason: null };
}

/**
 * The inverse of `computeRisk`: the stop-loss distance that produces a given risk.
 *
 * Used only by the mock provider, to emit prices that reproduce a target risk exactly through
 * the same formula the sync applies. Keeping it next to the forward calculation means the two
 * cannot drift apart — if the risk rule changes, the generated fixtures change with it.
 */
export function stopDistanceForRisk(
  targetRisk: number,
  inputs: {
    spec: SymbolSpec;
    volume: number;
    entryPrice: number;
    accountCurrency: string;
    quoteRates?: Record<string, number>;
  },
): number | null {
  const rate = quoteToAccountRate(
    inputs.spec,
    inputs.entryPrice,
    inputs.accountCurrency,
    inputs.quoteRates,
  );
  if (rate === null || !(inputs.volume > 0)) return null;
  return targetRisk / (inputs.spec.contractSize * inputs.volume * rate);
}

/** Price move (in quote currency) that yields a given account-currency profit. */
export function priceMoveForProfit(
  targetProfit: number,
  inputs: {
    spec: SymbolSpec;
    volume: number;
    entryPrice: number;
    accountCurrency: string;
    quoteRates?: Record<string, number>;
  },
): number | null {
  return stopDistanceForRisk(targetProfit, inputs);
}

/**
 * Why a stored trade has no R multiple, worked out from the row itself.
 *
 * `computeRisk` already returns a reason and the sync throws it away — it is not a column, and
 * no screen ever asked for it. So both places that had to say something said the same thing:
 * "this trade had no stop loss". On a trade whose stop loss is printed two lines further down
 * the same card, that is not a shortcut, it is the screen contradicting itself, and it sent a
 * trader looking for a broken import when the real answer was a symbol the contract-size table
 * had never heard of.
 *
 * Derived rather than persisted, deliberately. Every input this needs is on the row — a
 * migration would add a column that can go stale against the very tables it is derived from,
 * and it would still say nothing about the forty-nine rows already written. The one reason it
 * cannot distinguish is `unconvertible`, which needs the account currency; that case falls to
 * `rate`, which is the honest answer for it anyway.
 */
/**
 * Why a trade shows no R multiple — the four words the dash on the trade card stands for, plus
 * the one that means the dash is stale.
 *
 * It re-runs `computeRisk` rather than restating its rules. An earlier version walked the same
 * checks in the same order by hand, which is a second copy of the logic that decides a money
 * figure and would drift from the first the moment either changed. Whatever `computeRisk`
 * refuses on is what the reader is told.
 *
 * `stale` is the case that reading the row alone cannot explain: everything needed is present
 * and the number computes right now, so the stored null is not a property of the trade — it is
 * a leftover from a sync that ran while the specification fetch was broken. Saying "no
 * exchange rate was available" there would be a confident wrong answer, which is the failure
 * this whole investigation started from.
 */
export type MissingRrReason = NonNullable<RiskResult['reason']> | 'stale';

export function explainMissingRr(
  trade: Pick<RiskInputs, 'symbol' | 'direction' | 'entryPrice' | 'stopLoss' | 'volume'>,
  accountCurrency: string,
): MissingRrReason {
  const { reason } = computeRisk({ ...trade, accountCurrency });
  return reason ?? 'stale';
}
