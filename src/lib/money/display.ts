import 'server-only';
import type { Locale } from '@/i18n/config';
import { asCurrency, formatMoney, type Currency, type MoneyDisplay } from './currency';
import { convert, getFxRate, hasRate, type FxRate } from './fx';

/**
 * Binds "what currency is this number in" to "what currency does the user read in", once per
 * request, so pages format money by calling `money(value)` and cannot forget to convert.
 *
 * When there is no rate at all, figures render in the source currency rather than being
 * converted at 1:1 — a wrong number is worse than an unexpected symbol, and `converted` lets
 * the UI mention it.
 */
export type MoneyFormatter = {
  /** Formats an amount that is denominated in the source currency. */
  (amount: number, options?: { decimals?: number; signed?: boolean }): string;
};

export type DisplayMoney = {
  money: MoneyFormatter;
  /** The serialisable half, for client components — see `MoneyDisplay`. */
  display: MoneyDisplay;
  /** The currency figures are actually being rendered in. */
  currency: Currency | string;
  sourceCurrency: string;
  /** False when no rate was available and amounts are shown in the source currency. */
  converted: boolean;
  /** True when the rate used is older than today. */
  stale: boolean;
  fx: FxRate;
};

export async function displayMoney(options: {
  /** Currency the underlying numbers are in — the MT5 account currency, or ILS for finance. */
  source: string;
  /** The user's chosen display currency. */
  display: string;
  locale: Locale;
}): Promise<DisplayMoney> {
  const source = options.source.toUpperCase();
  const target = asCurrency(options.display);
  const fx = await getFxRate(source, target);
  const converted = hasRate(fx);

  // With no rate the amount stays in its source currency, so the symbol must too — including
  // when that currency is not one the user can choose to read in. `asCurrency` used to be
  // here and silently substituted the *target* for any unrecognised code, which rendered a
  // thousand Swiss francs as "$1,000": the exact failure this module exists to prevent.
  const currency: Currency | string = converted ? target : source;

  const money: MoneyFormatter = (amount, opts) =>
    formatMoney(converted ? convert(amount, fx) : amount, currency, options.locale, opts);

  const display: MoneyDisplay = {
    currency,
    locale: options.locale,
    rate: converted ? fx.rate : 1,
  };

  return { money, display, currency, sourceCurrency: source, converted, stale: fx.stale, fx };
}
