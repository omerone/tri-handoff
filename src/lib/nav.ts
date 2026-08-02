/**
 * The navigation strip.
 *
 * `enabled` is flipped on as each milestone lands its page, so the nav never advertises a
 * route that 404s. Order matches the prototype.
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
};

export const NAV: readonly NavDefinition[] = [
  { key: 'dash', href: '/dashboard', label: 'dash', enabled: true },
  { key: 'analytics', href: '/analytics', label: 'analytics', enabled: true }, // M1.5
  { key: 'trades', href: '/trades', label: 'trades', enabled: true }, // M1.6
  { key: 'calendar', href: '/calendar', label: 'calendar', enabled: true }, // M1.7
  { key: 'finance', href: '/finance', label: 'finance', enabled: true },
  { key: 'long', href: '/long', label: 'long', enabled: false }, // P3
  { key: 'settings', href: '/settings', label: 'settings', enabled: true },
];

export const enabledNav = (): readonly NavDefinition[] => NAV.filter((item) => item.enabled);
