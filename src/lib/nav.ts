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
  /**
   * Whether the tab appears in the nav strip.
   *
   * Settings does not. It is a place you go to change something and then leave, not one of
   * the screens the trader moves between all day, and it was taking a seventh slot from six
   * that are read constantly. It lives in the header corner instead — see `AppShell` — which
   * is why this is a property of the route rather than a `filter` inside the shell: the strip
   * and the corner have to disagree about exactly one entry, and that disagreement should be
   * written down where the route is defined.
   */
  inStrip: boolean;
};

export const NAV: readonly NavDefinition[] = [
  { key: 'finance', href: '/finance', label: 'finance', enabled: true, ranged: true, inStrip: true },
  { key: 'dash', href: '/dashboard', label: 'dash', enabled: true, ranged: true, inStrip: true },
  { key: 'trades', href: '/trades', label: 'trades', enabled: true, ranged: true, inStrip: true }, // M1.6
  { key: 'long', href: '/long', label: 'long', enabled: true, ranged: false, inStrip: true },
  { key: 'calendar', href: '/calendar', label: 'calendar', enabled: true, ranged: true, inStrip: true }, // M1.7
  { key: 'analytics', href: '/analytics', label: 'analytics', enabled: true, ranged: true, inStrip: true }, // M1.5
  { key: 'settings', href: '/settings', label: 'settings', enabled: true, ranged: false, inStrip: false },
];

export const enabledNav = (): readonly NavDefinition[] => NAV.filter((item) => item.enabled);

/** What the nav strip shows, in the order it shows it. */
export const stripNav = (): readonly NavDefinition[] =>
  NAV.filter((item) => item.enabled && item.inStrip);

/** A route by key — for the pieces of the shell that link to one specific screen. */
export function navRoute(key: NavKey): NavDefinition {
  const found = NAV.find((item) => item.key === key);
  // Unreachable: `NavKey` is the union of the keys in `NAV`.
  if (!found) throw new Error(`no nav route for ${key}`);
  return found;
}

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
