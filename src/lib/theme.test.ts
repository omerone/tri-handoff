import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  asTheme,
  DEFAULT_THEME,
  isTheme,
  resolveTheme,
  THEMES,
  toneColor,
  signTone,
  TOKEN,
} from './theme';

describe('theme selection', () => {
  it('defaults to dark, as SPEC §1.1 specifies', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(asTheme(undefined)).toBe('dark');
    expect(asTheme('nonsense')).toBe('dark');
    expect(asTheme(null)).toBe('dark');
  });

  it('accepts the three real options', () => {
    expect(THEMES).toEqual(['dark', 'light', 'system']);
    for (const theme of THEMES) expect(asTheme(theme)).toBe(theme);
    expect(isTheme('sepia')).toBe(false);
  });
});

describe('resolving the saved preference against the cookie', () => {
  it('paints the saved preference, whatever the cookie says', () => {
    // The bug this exists for: row says light, cookie missing or stale, so the page painted
    // dark while Settings — which reads the row — showed "light" selected.
    expect(resolveTheme('light', undefined)).toBe('light');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('system', 'dark')).toBe('system');
  });

  it('falls back to the cookie when there is no session to read a preference from', () => {
    expect(resolveTheme(undefined, 'light')).toBe('light');
    expect(resolveTheme(null, 'system')).toBe('system');
  });

  it('defaults when neither source has an answer', () => {
    expect(resolveTheme(undefined, undefined)).toBe(DEFAULT_THEME);
    expect(resolveTheme('sepia', 'sepia')).toBe(DEFAULT_THEME);
    // A row value that is not a theme must not shadow a cookie that is one.
    expect(resolveTheme('sepia', 'light')).toBe('light');
  });
});

/**
 * The stylesheet is the theme implementation, so these read it.
 *
 * They are cheap and they guard the two ways this breaks silently: a token defined in one
 * theme and forgotten in the other (which renders a colour from the wrong palette, or
 * nothing), and `system` being wired up in JavaScript, which would mean the server rendering
 * one theme and the client correcting it — a visible flash on every page load.
 */
describe('the stylesheet', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    expect(start, `${selector} is missing`).toBeGreaterThan(-1);
    const open = css.indexOf('{', start);
    return css.slice(open, css.indexOf('\n}', open));
  };

  const tokensIn = (source: string): string[] =>
    [...source.matchAll(/--tri-[a-z0-9-]+/g)].map((match) => match[0]).sort();

  it('defines exactly the same tokens in dark and light', () => {
    const dark = new Set(tokensIn(block("[data-theme='dark']")));
    const light = new Set(tokensIn(block("[data-theme='light']")));

    // A token present in one theme and not the other is a colour that silently falls back to
    // the other palette's value, which is how a green ends up unreadable on white.
    expect([...light].filter((token) => !dark.has(token))).toEqual([]);
    expect([...dark].filter((token) => !light.has(token))).toEqual([]);
    expect(dark.size).toBeGreaterThan(10);
  });

  it('gives `system` the light palette under a prefers-color-scheme query', () => {
    const light = new Set(tokensIn(block("[data-theme='light']")));
    const systemLight = new Set(tokensIn(css.slice(css.indexOf('@media (prefers-color-scheme: light)'))));

    for (const token of light) {
      expect(systemLight.has(token), `${token} missing from the system-light block`).toBe(true);
    }
  });

  it('declares color-scheme for each theme, so form controls follow', () => {
    expect(block("[data-theme='dark']")).toContain('color-scheme: dark');
    expect(block("[data-theme='light']")).toContain('color-scheme: light');
    expect(block("[data-theme='system']")).toContain('color-scheme: light dark');
  });
});

describe('token helpers', () => {
  it('resolve to CSS variables rather than literal colours', () => {
    // Anything hardcoded here would be one theme's palette pinned into JavaScript.
    for (const value of Object.values(TOKEN)) {
      expect(value).toMatch(/^var\(--tri-/);
    }
    expect(toneColor('pos')).toBe(TOKEN.pos);
    expect(toneColor('neg')).toBe(TOKEN.neg);
    expect(toneColor('neutral')).toBe(TOKEN.text);
  });

  it('treats zero as positive, matching the metrics convention for signs', () => {
    expect(signTone(0)).toBe('pos');
    expect(signTone(0.01)).toBe('pos');
    expect(signTone(-0.01)).toBe('neg');
  });
});
