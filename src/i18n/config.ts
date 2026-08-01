export const LOCALES = ['he', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Hebrew is the default per SPEC §4. */
export const DEFAULT_LOCALE: Locale = 'he';

export const LOCALE_COOKIE = 'tri_locale';

export const LOCALE_DIR: Record<Locale, 'rtl' | 'ltr'> = {
  he: 'rtl',
  en: 'ltr',
};

/** BCP-47 tags used for Intl number/date formatting. */
export const LOCALE_TAG: Record<Locale, string> = {
  he: 'he-IL',
  en: 'en-US',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
