import 'server-only';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, type Locale } from '@/i18n/config';
import { THEME_COOKIE, type Theme } from '@/lib/theme';
import { DISPLAY_STYLE_COOKIE, type DisplayStyle } from '@/lib/display-style';
import { formatRange, type TimeRange } from '@/lib/time/range';

const ONE_YEAR = 365 * 24 * 60 * 60;

/** Neither value is a secret, and only the server reads them. */
const OPTIONS = {
  httpOnly: false,
  sameSite: 'lax',
  path: '/',
  maxAge: ONE_YEAR,
} as const;

/**
 * The cookie copies of the two preferences the *root layout* needs before it can paint —
 * `<html data-theme>` and `<html lang dir>`. They are written here rather than at each call
 * site so the switcher, the sign-in flow and anything added later agree on the name, the
 * lifetime and the flags.
 *
 * The user row remains the durable copy; see `resolveTheme` for which one wins when they
 * disagree.
 */
export async function setThemeCookie(theme: Theme): Promise<void> {
  (await cookies()).set(THEME_COOKIE, theme, OPTIONS);
}

/** The third thing the root layout paints from: `<html data-style>`. */
export async function setDisplayStyleCookie(style: DisplayStyle): Promise<void> {
  (await cookies()).set(DISPLAY_STYLE_COOKIE, style, OPTIONS);
}

export async function setLocaleCookie(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, OPTIONS);
}

/**
 * The time range every screen is read through.
 *
 * A cookie rather than a row, because this is where the user is looking rather than how they
 * want the product set up — and because it has to survive following a plain `<Link>` from the
 * dashboard to the trades table, which carries no query string of its own. The relative
 * presets are stored as words (`this-month`), so a cookie written in July still means July's
 * successor in August.
 */
export const RANGE_COOKIE = 'tri_range';

export async function setRangeCookie(range: TimeRange): Promise<void> {
  (await cookies()).set(RANGE_COOKIE, formatRange(range), OPTIONS);
}
