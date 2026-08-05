import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import he from '@/messages/he.json';
import { enabledNav, HOME_PATH, isRangedPath, NAV, safeAppPath } from './nav';

/**
 * The nav is the one place where a route can be advertised before it exists: `enabled` is
 * flipped on per milestone, and nothing else checks that the page landed. These tests are
 * the check — a nav entry that is on but has no page is a 404 in the shell of every screen.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

/** Every route the App Router actually serves, with `(group)` segments collapsed away. */
function routes(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
      found.push(...routes(`${dir}/${entry.name}`, segment));
    } else if (entry.name === 'page.tsx') {
      found.push(prefix || '/');
    }
  }
  return found;
}

describe('nav definitions', () => {
  it('only enables entries whose page exists', () => {
    const served = routes(APP_DIR);
    for (const item of enabledNav()) {
      expect(served, `${item.href} is enabled in NAV but has no page`).toContain(item.href);
    }
  });

  it('has a translation for every entry in both catalogues', () => {
    for (const item of NAV) {
      expect(en.nav, `en.nav.${item.label}`).toHaveProperty(item.label);
      expect(he.nav, `he.nav.${item.label}`).toHaveProperty(item.label);
    }
  });

  it('has unique keys and hrefs', () => {
    expect(new Set(NAV.map((i) => i.key)).size).toBe(NAV.length);
    expect(new Set(NAV.map((i) => i.href)).size).toBe(NAV.length);
  });

  it('uses the key as its translation key, so the shell can look it up blind', () => {
    // AppShell renders t(`nav.${item.label}`); a label that drifts from the key produces a
    // next-intl fallback of the raw path in the UI rather than an error.
    expect(NAV.every((i) => i.label === i.key)).toBe(true);
  });

  it('keeps every href root-absolute', () => {
    expect(NAV.every((i) => i.href.startsWith('/'))).toBe(true);
  });
});

describe('enabledNav', () => {
  it('preserves the prototype order and drops nothing else', () => {
    expect(enabledNav().map((i) => i.key)).toEqual(
      NAV.filter((i) => i.enabled).map((i) => i.key),
    );
  });

  it('never hides the dashboard or settings — the shell has no other way out', () => {
    const keys = enabledNav().map((i) => i.key);
    expect(keys).toContain('dash');
    expect(keys).toContain('settings');
  });
});

/**
 * Which screens the time range applies to.
 *
 * The picker renders itself from these flags, so a route added without one silently gains — or
 * silently loses — a control the rest of the product has.
 */
describe('ranged routes', () => {
  it('covers every screen that reads a period, and no others', () => {
    const ranged = NAV.filter((item) => item.ranged)
      .map((item) => item.href)
      .sort();
    // Learning is here because the study ledger is a period like any other — "how many hours
    // this month" is the question it exists to answer.
    expect(ranged).toEqual([
      '/analytics',
      '/calendar',
      '/dashboard',
      '/finance',
      '/learning',
      '/trades',
    ]);
  });

  it('leaves out the screens that are statements about now', () => {
    // Open positions and Settings have no period to narrow; a picker over either would be a
    // control that changes nothing on screen.
    expect(isRangedPath('/long')).toBe(false);
    expect(isRangedPath('/settings')).toBe(false);
  });

  it('matches the list route but not a single trade', () => {
    expect(isRangedPath('/trades')).toBe(true);
    // One trade has one close date. Narrowing it by a window can only hide it.
    expect(isRangedPath('/trades/abc123')).toBe(false);
  });

  it('says no to anything it does not recognise', () => {
    expect(isRangedPath('/')).toBe(false);
    expect(isRangedPath('/dashboard/')).toBe(false);
  });
});

/**
 * The range picker posts the page it was used on, and a hidden field is client-controlled.
 * These are the shapes that turn a "come back here" into somebody else's site.
 */
describe('safeAppPath', () => {
  it('keeps an ordinary in-app path', () => {
    for (const path of ['/dashboard', '/trades', '/trades/abc-123', '/']) {
      expect(safeAppPath(path)).toBe(path);
    }
  });

  it('refuses anything that could leave the app', () => {
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/dashboard?next=https://evil.example',
      '/dashboard#/../../x',
      'dashboard',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(safeAppPath(hostile), String(hostile)).toBe(HOME_PATH);
    }
  });
});
