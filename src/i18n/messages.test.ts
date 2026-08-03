import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import he from '../messages/he.json';
import { DEFAULT_LOCALE, isLocale, LOCALE_DIR, LOCALES } from './config';

type Tree = { [key: string]: unknown };

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** ICU argument names in a message: `{count}` and `{count, plural, …}` both yield `count`. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map((m) => m[1] as string).sort();
}

function lookup(tree: Tree, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, key) => (node && typeof node === 'object' ? (node as Tree)[key] : undefined),
      tree,
    );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/**
 * Every `t('…')` call site paired with the namespace its translator was created with.
 * `getTranslations()` with no argument is the root namespace, so the key is already a full path.
 */
function callSites(source: string): { key: string; namespaces: string[]; hasArgs: boolean }[] {
  const vars = new Map<string, Set<string>>();
  const decl =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:getTranslations|useTranslations)\(([^)]*)\)/g;
  for (const [, name, rawArg] of source.matchAll(decl)) {
    const arg = (rawArg as string).trim();
    const namespace =
      arg === ''
        ? ''
        : (/['"]([^'"]+)['"]/.exec(arg.replace(/^\{[\s\S]*?namespace:/, ''))?.[1] ?? null);
    if (namespace === null) continue; // A computed namespace can't be resolved statically.
    const known = vars.get(name as string) ?? new Set<string>();
    known.add(namespace);
    vars.set(name as string, known);
  }

  const call = /\b([A-Za-z_$][\w$]*)\(\s*(['"])([^'"]+)\2\s*([,)])/g;
  return [...source.matchAll(call)]
    .filter(([, name]) => vars.has(name as string))
    .map(([, name, , key, next]) => ({
      key: key as string,
      namespaces: [...(vars.get(name as string) as Set<string>)],
      hasArgs: next === ',',
    }));
}

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

  it('use the same ICU placeholders in Hebrew and English', () => {
    const mismatched: string[] = [];
    const walk = (node: unknown, prefix: string) => {
      if (typeof node === 'string') {
        const other = lookup(en as unknown as Tree, prefix);
        if (typeof other === 'string' && placeholders(node).join() !== placeholders(other).join()) {
          mismatched.push(prefix);
        }
        return;
      }
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        for (const [k, v] of Object.entries(node as Tree)) walk(v, prefix ? `${prefix}.${k}` : k);
      }
    };
    walk(he, '');
    expect(mismatched).toEqual([]);
  });
});

/**
 * next-intl throws a FORMATTING_ERROR at render time when a message expects `{count}` and the
 * call site passes nothing — a crash no type-check catches, in whichever locale happens to carry
 * the placeholder. This walks the call sites instead, so the failure lands here rather than in a
 * page the user opened.
 */
describe('translation call sites', () => {
  const sites = sourceFiles(SRC).flatMap((file) =>
    callSites(readFileSync(file, 'utf8')).map((site) => ({ ...site, file })),
  );

  it('finds call sites to check', () => {
    expect(sites.length).toBeGreaterThan(50);
  });

  it('pass arguments to every message that has placeholders', () => {
    const bare = sites
      .filter((site) => !site.hasArgs)
      .filter((site) =>
        site.namespaces.some((ns) => {
          const path = ns ? `${ns}.${site.key}` : site.key;
          return [he, en].some((catalogue) => {
            const message = lookup(catalogue as unknown as Tree, path);
            return typeof message === 'string' && placeholders(message).length > 0;
          });
        }),
      )
      .map((site) => `${site.file.replace(SRC, 'src/')}: ${site.namespaces[0]}.${site.key}`);
    expect(bare).toEqual([]);
  });

  it('only reference keys that exist in both catalogues', () => {
    const missing = sites
      .filter((site) =>
        site.namespaces.every((ns) => {
          const path = ns ? `${ns}.${site.key}` : site.key;
          return [he, en].some((c) => typeof lookup(c as unknown as Tree, path) !== 'string');
        }),
      )
      .map((site) => `${site.file.replace(SRC, 'src/')}: ${site.namespaces[0]}.${site.key}`);
    expect(missing).toEqual([]);
  });
});
