import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/config';
import {
  asCurrency,
  CURRENCY_SYMBOL,
  formatMoney,
  formatNumber,
  formatPercent,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from './currency';

/** LRM, RLM and ALM — the bidi control characters Intl inserts in an RTL locale. */
const BIDI = /[\u200e\u200f\u061c]/;

describe('formatMoney', () => {
  it('glues the symbol to a grouped, decimal-less figure', () => {
    expect(formatMoney(12345, 'ILS', 'en')).toBe('₪12,345');
    expect(formatMoney(0, 'USD', 'en')).toBe('$0');
    expect(formatMoney(1234.4, 'EUR', 'en')).toBe('€1,234');
  });

  it('honours the decimals option', () => {
    expect(formatMoney(1234.567, 'USD', 'en', { decimals: 2 })).toBe('$1,234.57');
    expect(formatMoney(1234.5, 'USD', 'en', { decimals: 2 })).toBe('$1,234.50');
  });

  it('puts the minus outside the symbol', () => {
    expect(formatMoney(-1234, 'ILS', 'en')).toBe('-₪1,234');
    expect(formatMoney(-1234, 'USD', 'en', { decimals: 2 })).toBe('-$1,234.00');
  });

  /**
   * The whole point of formatting the *magnitude* and prepending the sign by hand: he-IL
   * renders a negative number as "-1,234" and `style: 'currency'` as
   * "12,345.00 ₪" — a trailing symbol and invisible bidi marks that break the
   * compact KPI tiles the prototype specifies. Hebrew and English must therefore produce
   * byte-identical money strings.
   */
  describe('RTL locale', () => {
    it('formats identically in Hebrew and English', () => {
      for (const amount of [12345, -12345, 0, 1234.56]) {
        expect(formatMoney(amount, 'ILS', 'he')).toBe(formatMoney(amount, 'ILS', 'en'));
      }
    });

    it('emits no bidi control characters and leads with the symbol', () => {
      for (const locale of LOCALES) {
        for (const amount of [12345, -12345, -0.4, 0]) {
          const out = formatMoney(amount, 'ILS', locale, { decimals: 2 });
          expect(out).not.toMatch(BIDI);
          expect(out.replace(/^-/, '').startsWith('₪')).toBe(true);
        }
      }
    });

    it('uses an ASCII hyphen-minus for negatives in both locales', () => {
      expect(formatMoney(-7, 'ILS', 'he')).toBe('-₪7');
    });
  });

  describe('rounding', () => {
    // Half away from zero, unlike Math.round, which rounds .5 towards +∞ and would turn a
    // half-shekel loss into a gain of nothing (-0.5 → -0) and -1.5 into -1.
    it('rounds halves away from zero', () => {
      expect(formatMoney(0.5, 'ILS', 'en')).toBe('₪1');
      expect(formatMoney(-0.5, 'ILS', 'en')).toBe('-₪1');
      expect(formatMoney(-1.5, 'ILS', 'en')).toBe('-₪2');
      expect(formatMoney(2.5, 'ILS', 'en')).toBe('₪3');
      expect(formatMoney(-0.25, 'USD', 'en', { decimals: 1 })).toBe('-$0.3');
    });

    // A loss too small to show must not render as "-₪0": a minus sign in front of nothing
    // reads as a broken figure, and the KPI tiles colour by the sign of the string.
    it('never prints a signed zero', () => {
      expect(formatMoney(-0, 'ILS', 'en')).toBe('₪0');
      expect(formatMoney(-0.4, 'ILS', 'en')).toBe('₪0');
      expect(formatMoney(-0.004, 'USD', 'en', { decimals: 2 })).toBe('$0.00');
    });
  });

  describe('signed option', () => {
    it('marks a gain with a plus and leaves a loss with its minus', () => {
      expect(formatMoney(1234, 'ILS', 'en', { signed: true })).toBe('+₪1,234');
      expect(formatMoney(-1234, 'ILS', 'en', { signed: true })).toBe('-₪1,234');
      expect(formatMoney(12.34, 'USD', 'en', { signed: true, decimals: 2 })).toBe('+$12.34');
    });

    // Consequence of never printing a signed zero: a magnitude that rounds away carries the
    // plus, because there is no "-0" to distinguish it from a gain of nothing.
    it('shows a plus for zero and for a loss that rounds to zero', () => {
      expect(formatMoney(0, 'ILS', 'en', { signed: true })).toBe('+₪0');
      expect(formatMoney(-0.4, 'ILS', 'en', { signed: true })).toBe('+₪0');
    });

    it('never emits a doubled sign', () => {
      for (const amount of [-1234, -0.5, -0]) {
        expect(formatMoney(amount, 'ILS', 'en', { signed: true })).not.toMatch(/^[+-]{2}/);
      }
    });
  });

  it('has a symbol for every supported currency', () => {
    for (const currency of SUPPORTED_CURRENCIES) {
      expect(CURRENCY_SYMBOL[currency]).toBeTruthy();
      expect(formatMoney(1, currency, 'en')).toBe(`${CURRENCY_SYMBOL[currency]}1`);
    }
  });
});

describe('formatNumber and formatPercent', () => {
  it('groups thousands and keeps the requested precision', () => {
    expect(formatNumber(12345, 'en')).toBe('12,345');
    expect(formatNumber(12345.678, 'en', 2)).toBe('12,345.68');
    expect(formatPercent(62.5, 'en')).toBe('62.5%');
    expect(formatPercent(62, 'en', 0)).toBe('62%');
  });

  // Unlike formatMoney these pass the signed value straight to Intl, so the Hebrew output
  // legitimately differs; the percent sign is appended literally and stays after the digits.
  it('keeps the percent sign trailing in Hebrew', () => {
    expect(formatPercent(62.5, 'he')).toMatch(/%$/);
  });
});

describe('currency guards', () => {
  // `users.display_currency` is a free-text column, so a value that predates a change to
  // SUPPORTED_CURRENCIES must fall back rather than reach CURRENCY_SYMBOL and render
  // "undefined12,345".
  it('falls back for anything that is not a supported code', () => {
    expect(asCurrency('JPY')).toBe('ILS');
    expect(asCurrency(undefined)).toBe('ILS');
    expect(asCurrency(null, 'USD')).toBe('USD');
    // Codes are matched exactly, so a lowercase column value falls back rather than
    // silently becoming a different currency.
    expect(asCurrency('usd')).toBe('ILS');
    expect(asCurrency('USD')).toBe('USD');
  });

  it('accepts exactly the supported codes', () => {
    expect(SUPPORTED_CURRENCIES.every(isSupportedCurrency)).toBe(true);
    expect(isSupportedCurrency('JPY')).toBe(false);
    expect(isSupportedCurrency(42)).toBe(false);
    expect(isSupportedCurrency(undefined)).toBe(false);
  });
});
