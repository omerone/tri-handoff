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

/**
 * The symbol for any ISO code, not just the four the user can choose to read in.
 *
 * An MT5 account can be denominated in anything — CHF, JPY, AUD. When no exchange rate is
 * available, figures are shown in the account's own currency rather than converted, and they
 * need a symbol that is not a lie. Unknown codes fall back to the code itself.
 */
const EXTRA_SYMBOLS: Record<string, string> = {
  JPY: '¥',
  CHF: 'CHF ',
  AUD: 'A$',
  CAD: 'C$',
  NZD: 'NZ$',
  SEK: 'kr ',
  NOK: 'kr ',
  PLN: 'zł ',
  ZAR: 'R',
};

export function symbolFor(currency: string): string {
  const code = currency.toUpperCase();
  if (isSupportedCurrency(code)) return CURRENCY_SYMBOL[code];
  return EXTRA_SYMBOLS[code] ?? `${code} `;
}

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
  /** Any ISO code — not only the four a user can pick to read in. See `symbolFor`. */
  currency: Currency | string,
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
  return `${sign}${symbolFor(currency)}${digits}`;
}

/**
 * Everything a client component needs to format money, and nothing it cannot receive.
 *
 * Charts run in the browser, and a server component cannot hand one a formatting *function* —
 * props have to survive serialisation. So the rate, the currency and the locale cross the
 * boundary as data and `formatDisplayMoney` does the same arithmetic on both sides. One
 * formatting rule, two runtimes, no chance of the axis disagreeing with the KPI tile above it.
 */
export type MoneyDisplay = {
  currency: Currency | string;
  locale: Locale;
  /** Source currency → display currency. 1 when they are the same or no rate was available. */
  rate: number;
};

export function formatDisplayMoney(
  amount: number,
  display: MoneyDisplay,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  return formatMoney(amount * display.rate, display.currency, display.locale, options);
}

/**
 * A money value short enough for a chart's value axis: `₪18K`.
 *
 * The axis reserved 56 pixels for a full `₪18,344`, which fits at a desktop width and gets
 * clipped to `,344` on a phone once the plot squeezes it — an axis of numbers missing their
 * leading digits is worse than no axis, because it still looks authoritative. The tooltip and
 * the captions below the chart carry the exact figures.
 */
export function formatCompactMoney(value: number, display: MoneyDisplay): string {
  const amount = value * display.rate;
  const digits = new Intl.NumberFormat(LOCALE_TAG[display.locale], {
    notation: 'compact',
    maximumFractionDigits: Math.abs(amount) < 10_000 ? 1 : 0,
  }).format(amount);
  const symbol = CURRENCY_SYMBOL[display.currency as Currency] ?? '';
  return `${symbol}${digits}`;
}

export function formatNumber(value: number, locale: Locale, decimals = 0): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * A signed figure short enough for a calendar square on a phone: `+1.2K`, `-492`.
 *
 * Seven columns on a 375px screen leave about forty pixels of text per day, and `+₪1,165`
 * needs sixty — so it wrapped, one line per glyph run, and neighbouring days ran into each
 * other. The currency symbol is dropped rather than the digits: the month total above the
 * grid names the currency once, and which day was good is what the squares are for.
 */
export function formatCompactSigned(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) < 1000 ? 0 : 1,
    signDisplay: 'exceptZero',
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
