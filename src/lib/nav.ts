/**
 * The navigation strip.
 *
 * `enabled` is flipped on as each milestone lands its page, so the nav never advertises a
 * route that 404s.
 *
 * The order below is the order the user reads. Hebrew is the default locale, so the strip
 * renders right to left and this array runs from the rightmost tab to the leftmost — the
 * first entry is the one under the reader's thumb, not the one on the far side of the screen.
 */
export type NavKey =
  | 'dash'
  | 'analytics'
  | 'trades'
  | 'calendar'
  | 'finance'
  | 'long'
  | 'settings';

export type NavDefinition = {
  key: NavKey;
  href: string;
  /** Translation key under the `nav` namespace. */
  label: NavKey;
  enabled: boolean;
  /**
   * Whether the screen reads its data through the time range, and therefore whether the range
   * picker appears above it.
   *
   * A property of the route rather than a list inside the picker component, so the answer sits
   * next to the route it is about and the tests can check it against what each page actually
   * does. The two that are off are off for the same reason: they are statements about *now*
   * rather than about a period. Long positions are what is open at this moment, and Settings
   * is not data at all — a picker over either would be a control that changes nothing.
   */
  ranged: boolean;
};

export const NAV: readonly NavDefinition[] = [
  // Finance, trades, then analytics: the three screens this trader opens most, in that order,
  // starting at the right-hand edge. The prototype led with the dashboard; it now follows
  // them, and `HOME_PATH` still points there — where a form returns to is a separate question
  // from what the nav puts first.
  { key: 'finance', href: '/finance', label: 'finance', enabled: true, ranged: true },
  { key: 'trades', href: '/trades', label: 'trades', enabled: true, ranged: true }, // M1.6
  { key: 'analytics', href: '/analytics', label: 'analytics', enabled: true, ranged: true }, // M1.5
  { key: 'dash', href: '/dashboard', label: 'dash', enabled: true, ranged: true },
  { key: 'calendar', href: '/calendar', label: 'calendar', enabled: true, ranged: true }, // M1.7
  { key: 'long', href: '/long', label: 'long', enabled: true, ranged: false },
  { key: 'settings', href: '/settings', label: 'settings', enabled: true, ranged: false },
];

export const enabledNav = (): readonly NavDefinition[] => NAV.filter((item) => item.enabled);

/**
 * Whether the range picker belongs above this path.
 *
 * Exact matches only. `/trades` is a period — everything closed in the window — while
 * `/trades/abc` is one trade, which has a single close date and nothing to narrow.
 */
export function isRangedPath(pathname: string): boolean {
  return NAV.some((item) => item.ranged && item.href === pathname);
}

/** Where a form is sent back to when it has nowhere better. */
export const HOME_PATH = '/dashboard';

/**
 * A path submitted by the browser, made safe to redirect to.
 *
 * The range picker posts the page it was used on so the action can return the user there, and
 * a hidden field is a value the client controls. Anything that is not a single root-relative
 * path — an absolute URL, a protocol-relative `//evil.example`, a backslash that some browsers
 * normalise to a slash, a query or fragment smuggled into the path — becomes the dashboard.
 * An open redirect that any signed-in user can post to is not worth the convenience.
 */
export function safeAppPath(value: unknown): string {
  const path = typeof value === 'string' ? value : '';
  if (!path.startsWith('/') || path.startsWith('//')) return HOME_PATH;
  return /^\/[A-Za-z0-9\-._~/]*$/.test(path) ? path : HOME_PATH;
}
