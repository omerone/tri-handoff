import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import he from '../messages/he.json';
import { DEFAULT_LOCALE, isLocale, LOCALE_DIR, LOCALES } from './config';

type Tree = { [key: string]: unknown };

/** Flattens a message tree to dotted paths, so a missing translation is a diff of two arrays. */
function paths(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node)) return [`${prefix}[]`];
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Tree)
    .flatMap(([key, value]) => paths(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('locale config', () => {
  it('marks Hebrew as the default and RTL', () => {
    expect(DEFAULT_LOCALE).toBe('he');
    expect(LOCALE_DIR.he).toBe('rtl');
    expect(LOCALE_DIR.en).toBe('ltr');
  });

  it('recognises only the supported locales', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('message catalogues', () => {
  it('have exactly the same keys in Hebrew and English', () => {
    expect(paths(he)).toEqual(paths(en));
  });

  it('have no empty strings', () => {
    const empties: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node === 'string') {
        if (node.trim() === '') empties.push(prefix);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${prefix}[${i}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Tree)) walk(v, prefix ? `${prefix}.${k}` : k);
      }
    };
    walk(he, '');
    walk(en, '');
    expect(empties).toEqual([]);
  });

  it('agree on the number of weekday labels', () => {
    expect(he.calendar.weekdays).toHaveLength(7);
    expect(en.calendar.weekdays).toHaveLength(7);
  });
});
