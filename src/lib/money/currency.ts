import type { Locale } from '@/i18n/config';
import { LOCALE_TAG } from '@/i18n/config';

/**
 * Display currencies the user can pick (SPEC §3.1 — "המשתמש בוחר את המטבע שלו בהגדרות").
 * Trading data arrives in the MT5 account currency and personal finance is ILS-native;
 * both get converted at render time using the daily FX rate.
 */
export const SUPPORTED_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function asCurrency(value: unknown, fallback: Currency = 'ILS'): Currency {
  return isSupportedCurrency(value) ? value : fallback;
}

/**
 * Money formatting used everywhere in the UI.
 *
 * The prototype writes `₪12,345` — symbol glued to the number, no decimals, grouped
 * thousands — rather than the locale-default `‏12,345.00 ₪`. That compactness is what makes
 * six KPI tiles fit on a phone, so it is reproduced here instead of using
 * `style: 'currency'`.
 */
export function formatMoney(
  amount: number,
  currency: Currency,
  locale: Locale,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  const decimals = options.decimals ?? 0;
  const rounded = roundTo(amount, decimals);
  const magnitude = Math.abs(rounded);

  const digits = new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(magnitude);

  const sign = rounded < 0 ? '-' : options.signed ? '+' : '';
  return `${sign}${CURRENCY_SYMBOL[currency]}${digits}`;
}

export function formatNumber(value: number, locale: Locale, decimals = 0): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, locale: Locale, decimals = 1): string {
  return `${formatNumber(value, locale, decimals)}%`;
}

/** Half-away-from-zero, so -0.5 renders as -1 rather than -0. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return rounded / factor;
}
