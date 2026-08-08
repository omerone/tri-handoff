/**
 * Which visual language the interface is drawn in.
 *
 * Deliberately a separate axis from `theme`. Theme answers "light or dark", which is about
 * the room the trader is sitting in and changes through the day; style answers "which of the
 * three looks", which is a taste settled once. Folding them into one control would mean six
 * buttons in a row where two answers are being given, and picking a style would silently
 * change whether the screen is dark.
 *
 * So every style is drawn in both themes — six combinations, all of them in globals.css.
 *
 * Like the theme, this is resolved in CSS from a `data-style` attribute on `<html>` rather
 * than in JavaScript. Deciding it on the client would mean the server painting one style and
 * the browser correcting it, which is a visible flash on every page load.
 */

export const DISPLAY_STYLES = ['depth', 'instrument', 'calm'] as const;
export type DisplayStyle = (typeof DISPLAY_STYLES)[number];

/** What the product ships as, and what an unrecognised value falls back to. */
export const DEFAULT_DISPLAY_STYLE: DisplayStyle = 'depth';

export function isDisplayStyle(value: unknown): value is DisplayStyle {
  return typeof value === 'string' && (DISPLAY_STYLES as readonly string[]).includes(value);
}

export function asDisplayStyle(value: unknown): DisplayStyle {
  return isDisplayStyle(value) ? value : DEFAULT_DISPLAY_STYLE;
}

/**
 * The cookie exists so the *root layout* can paint a style without a database round trip on
 * every request, and so the sign-in screen — which has no session to read a row from — is
 * drawn in the style the user chose rather than always the default.
 */
export const DISPLAY_STYLE_COOKIE = 'tri_style';

/**
 * The style to paint, given the saved preference on the user row and the cookie.
 *
 * The row wins whenever there is one, for the same reason it does for the theme: the cookie
 * is a cache, and a cache can be missing or stale — cleared cookies, a new browser, or the
 * style changed on another device. When those disagree, painting the cookie's answer while
 * Settings reads the row shows one style on screen with a different one lit in the picker.
 *
 * Only a signed-out visitor has no row, and that is exactly the case the cookie exists for.
 */
export function resolveDisplayStyle(saved: unknown, cookieValue: unknown): DisplayStyle {
  return isDisplayStyle(saved) ? saved : asDisplayStyle(cookieValue);
}
