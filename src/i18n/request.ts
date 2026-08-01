import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from './config';

/**
 * The language is a per-user setting, not a URL segment: each tenant has exactly one user
 * and one domain, so prefixing every route with /he or /en would only add noise. The active
 * locale comes from a cookie, which the language switcher and the user's saved preference
 * both write.
 */
export async function resolveLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    timeZone: 'Asia/Jerusalem',
    formats: {
      dateTime: {
        short: { day: '2-digit', month: '2-digit' },
        time: { hour: '2-digit', minute: '2-digit' },
      },
    },
  };
});
