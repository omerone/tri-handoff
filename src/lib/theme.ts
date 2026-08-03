/**
 * Design tokens, mirrored from src/app/globals.css.
 *
 * Components should prefer the Tailwind classes (`bg-surface`, `text-dim`, …). This module
 * exists for the places that need a value in JS: SVG props in Recharts, and the heatmap /
 * R-strip which interpolate alpha at runtime.
 *
 * `TOKEN` gives the `var(--tri-*)` reference, which is theme-aware and usable wherever CSS
 * is accepted. There is deliberately no raw-channel export: anything that needs a colour at
 * a computed opacity uses `color-mix()` against the token, so it follows the theme instead
 * of pinning one theme's palette into JavaScript.
 */

export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'dark';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function asTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

/**
 * The cookie exists so the *root layout* can pick a theme without a database round trip on
 * every request — and, more importantly, so the sign-in screen honours the choice too, which
 * it cannot read from a session that does not exist yet. The user row is the durable copy.
 */
export const THEME_COOKIE = 'tri_theme';

/**
 * The theme to paint, given the saved preference on the user row and the cookie.
 *
 * The row wins whenever there is one. The cookie is a cache of it, and a cache can be missing
 * or stale — cleared cookies, a new browser, a year-old cookie that expired, or the theme
 * changed on another device. When that happened the page painted the cookie's answer (dark, by
 * default) while Settings read the row and showed "light" selected: the whole interface dark
 * with the light button lit. Same question, two sources, one of them wrong.
 *
 * Only a signed-out visitor has no row, and that is exactly the case the cookie exists for.
 */
export function resolveTheme(saved: unknown, cookieValue: unknown): Theme {
  return isTheme(saved) ? saved : asTheme(cookieValue);
}

export const TOKEN = {
  bg: 'var(--tri-bg)',
  surface: 'var(--tri-surface)',
  raised: 'var(--tri-raised)',
  line: 'var(--tri-line)',
  text: 'var(--tri-text)',
  dim: 'var(--tri-dim)',
  brand: 'var(--tri-brand)',
  brand2: 'var(--tri-brand-2)',
  pos: 'var(--tri-pos)',
  neg: 'var(--tri-neg)',
  warn: 'var(--tri-warn)',
} as const;

/** Tone → token, used by KPI tiles and any figure that is coloured by sign. */
export function toneColor(tone: 'pos' | 'neg' | 'neutral'): string {
  if (tone === 'pos') return TOKEN.pos;
  if (tone === 'neg') return TOKEN.neg;
  return TOKEN.text;
}

export function signTone(value: number): 'pos' | 'neg' {
  return value >= 0 ? 'pos' : 'neg';
}
