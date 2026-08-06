import { computeRisk } from './risk';
import type { SymbolSpec } from './symbols';
import type { Mt5Deal, PriceBar } from './types';

/**
 * MAE and MFE — how far a trade went the wrong way, and the right way, before it closed.
 *
 * The two figures a trading journal is supposed to have and this one did not. Everything else
 * the product records is about the *result*: entry, exit, profit, R. These are about what
 * happened in between, and they answer two questions no outcome can:
 *
 *   - **Was the stop too tight?** A trader whose winners are regularly stopped out first is
 *     paying for protection that costs more than it saves. A trader whose MAE never gets
 *     within half the stop distance is risking more than the trade actually needs.
 *   - **How much was left on the table?** The gap between the best price the trade ever saw
 *     and the price it was closed at is the cost of every early exit, added up. It is the only
 *     honest way to decide whether a trailing stop would have helped or hurt.
 *
 * **Expressed in the account currency, like `risk`.** Not in pips, which are not comparable
 * across instruments, and not in R, which is derived in the analytics where the risk is
 * already to hand. Money is the unit every other figure in the product uses, and it means
 * MAE can be read straight against `risk`: an MAE of 80 on a risk of 100 is a trade that came
 * within a fifth of its stop.
 *
 * **Both are positive, or null.** MAE is the size of the worst move against the position, so
 * a trade that never went against the entry at all has an MAE of zero — a real answer, not a
 * missing one. Null means the price history was not available, which is a different fact and
 * is kept different: the aggregates exclude nulls and count zeros, exactly as `rr` does.
 *
 * Pure and free of I/O, so it can be tested against fixtures without a broker — the same
 * property `aggregateDeals` has and for the same reason.
 */

export type Excursion = {
  /** Furthest against the entry, in account currency, as a positive number. */
  mae: number | null;
  /** Furthest in favour of the entry, in account currency, as a positive number. */
  mfe: number | null;
};

export const NO_EXCURSION: Excursion = { mae: null, mfe: null };

export type ExcursionContext = {
  accountCurrency: string;
  quoteRates?: Record<string, number>;
  spec?: SymbolSpec | null;
};

/**
 * The worst and best prices a position saw while it was open.
 *
 * Bars are filtered to the trade's own window before anything is measured. A caller handing
 * over a day of bars for a trade that lasted twenty minutes would otherwise be told about
 * price action that happened after the exit, which is not an excursion — it is hindsight, and
 * it would make every early close look worse than it was.
 *
 * The entry and exit bars are included by inclusive comparison at both ends: the bar
 * containing the entry is where the position started living, and the bar containing the exit
 * is where the high or low that triggered it happened.
 */
export function priceRangeDuring(
  bars: readonly PriceBar[],
  window: { from: Date; to: Date },
): { high: number; low: number } | null {
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let seen = false;

  const from = window.from.getTime();
  const to = window.to.getTime();

  for (const bar of bars) {
    const at = bar.at.getTime();
    if (at < from || at > to) continue;
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) continue;
    if (bar.high > high) high = bar.high;
    if (bar.low < low) low = bar.low;
    seen = true;
  }

  return seen ? { high, low } : null;
}

/**
 * Turns a price distance into account-currency money.
 *
 * Deliberately routed through `computeRisk` rather than reimplementing the formula. Risk is
 * `|entry − stop| × contractSize × volume × rate`, and an excursion is the identical
 * calculation with the excursion price standing in for the stop — so passing the price as
 * `stopLoss` reuses the contract-size table, the broker overrides, and all three cases of the
 * quote-to-account conversion, including the one where the account currency is the pair's own
 * base. Two copies of that logic would drift, and the copy here would be the one nobody
 * tested against a live account.
 *
 * Returns null for exactly the reasons risk is null: unknown symbol, unconvertible currency,
 * no volume. Zero distance is a legitimate answer here — the price never moved that way — so
 * it is handled before the call rather than treated as the failure it is for a stop loss.
 */
function distanceToMoney(deal: Mt5Deal, price: number, context: ExcursionContext): number | null {
  if (!Number.isFinite(price)) return null;
  if (Math.abs(price - deal.entryPrice) === 0) return 0;

  const result = computeRisk({
    symbol: deal.symbol,
    volume: deal.volume,
    entryPrice: deal.entryPrice,
    stopLoss: price,
    accountCurrency: context.accountCurrency,
    quoteRates: context.quoteRates,
    spec: context.spec,
  });

  return result.risk;
}

/**
 * MAE and MFE for one closed position, from the bars covering it.
 *
 * Which end of the range is adverse depends on the direction: a long suffers at the low and
 * profits at the high, a short the other way round. Getting that backwards would report every
 * short's drawdown as its run-up, and the mistake would be invisible on a book that is mostly
 * long — which most retail books are.
 */
export function computeExcursion(
  deal: Mt5Deal,
  bars: readonly PriceBar[],
  context: ExcursionContext,
): Excursion {
  if (deal.kind !== 'trade' || deal.closeAt === null) return NO_EXCURSION;

  const range = priceRangeDuring(bars, { from: deal.openAt, to: deal.closeAt });
  if (!range) return NO_EXCURSION;

  const long = deal.direction === 'long';
  const adversePrice = long ? range.low : range.high;
  const favourablePrice = long ? range.high : range.low;

  /*
   * Clamped at the entry. A bar's low can sit above a long's entry when the position was
   * opened at the top of its very first bar and price only ever rose — the trade never went
   * against the entry, so its adverse excursion is zero rather than a negative number that
   * would read as a profit.
   */
  const adverse = long
    ? Math.min(adversePrice, deal.entryPrice)
    : Math.max(adversePrice, deal.entryPrice);
  const favourable = long
    ? Math.max(favourablePrice, deal.entryPrice)
    : Math.min(favourablePrice, deal.entryPrice);

  return {
    mae: distanceToMoney(deal, adverse, context),
    mfe: distanceToMoney(deal, favourable, context),
  };
}
