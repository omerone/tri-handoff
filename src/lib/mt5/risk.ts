import { findSymbolSpec, type SymbolSpec } from './symbols';
import type { Mt5Deal } from './types';

/**
 * RISK AND RR — the rule, in one place.
 *
 *   risk = |entry price − stop loss| × contract size × volume × (quote → account rate)
 *   rr   = net profit / risk
 *
 * where net profit is the broker's `profit` with commission and swap already applied, since
 * that is the money that actually moved.
 *
 * **When there is no RR.** `rr` is null — not zero, not omitted quietly — whenever any input
 * is missing or nonsensical:
 *
 *   - the position carried no stop loss, so there was no defined risk to measure against;
 *   - the stop loss sat exactly at the entry, giving zero risk and an infinite ratio;
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
  | { risk: null; reason: 'no-stop-loss' | 'zero-distance' | 'unknown-symbol' | 'unconvertible' };

/**
 * Converts one unit of the symbol's quote currency into the account currency.
 *
 * Three cases, in order of confidence:
 *   1. already the account currency → 1;
 *   2. the account currency is the *base* of this very pair (USDJPY on a USD account) → the
 *      price itself is the rate, so one JPY is 1/price dollars. No external data needed, and
 *      it is exact for the moment of the trade;
 *   3. anything else → an explicitly supplied rate, or nothing.
 */
function quoteToAccountRate(
  spec: SymbolSpec,
  entryPrice: number,
  accountCurrency: string,
  quoteRates: Record<string, number> | undefined,
): number | null {
  const account = accountCurrency.toUpperCase();
  if (spec.quoteCurrency === account) return 1;

  if (spec.baseCurrency === account && entryPrice > 0) return 1 / entryPrice;

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

  const spec = inputs.spec ?? findSymbolSpec(inputs.symbol);
  if (!spec) return { risk: null, reason: 'unknown-symbol' };

  const distance = Math.abs(inputs.entryPrice - inputs.stopLoss);
  if (!(distance > 0) || !(inputs.volume > 0)) {
    return { risk: null, reason: 'zero-distance' };
  }

  const rate = quoteToAccountRate(spec, inputs.entryPrice, inputs.accountCurrency, inputs.quoteRates);
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
  context: { accountCurrency: string; quoteRates?: Record<string, number>; spec?: SymbolSpec | null },
): RrResult {
  const result = computeRisk({
    symbol: deal.symbol,
    volume: deal.volume,
    entryPrice: deal.entryPrice,
    stopLoss: deal.stopLoss,
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
  inputs: { spec: SymbolSpec; volume: number; entryPrice: number; accountCurrency: string; quoteRates?: Record<string, number> },
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
  inputs: { spec: SymbolSpec; volume: number; entryPrice: number; accountCurrency: string; quoteRates?: Record<string, number> },
): number | null {
  return stopDistanceForRisk(targetProfit, inputs);
}
