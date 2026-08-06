import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The premises under which two "high" advisories are being carried rather than fixed.
 *
 * `npm audit` reports four highs against this project, all of them inside Next's own tree:
 * postcss below 8.5.23 and sharp below 0.35.0. The only fix npm offers is `next@16`, which is
 * a major version — a migration of the App Router surface and of next-intl alongside it, run
 * against a dashboard someone trades a real account from. That is not a change to make on a
 * reflex, and "audit says high" is exactly the reflex that gets it made in a hurry.
 *
 * So the decision is to carry them, and it rests on two facts about *this* app rather than on
 * the advisories being wrong:
 *
 *   - **postcss runs at build time, over CSS this repository wrote.** The advisories are about
 *     attacker-controlled stylesheets and `sourceMappingURL` comments pointing at arbitrary
 *     files. Nothing here compiles CSS that came from a user, and the build runs in CI on our
 *     own source. There is no input to control.
 *
 *   - **sharp is reached only through `next/image`, which this app never uses.** No component
 *     imports it and no `remotePatterns` are configured, so `/_next/image` answers 400 for a
 *     remote URL and for a local one alike. Verified against production. The libvips CVEs need
 *     a malicious image to decode; there is no path by which one arrives.
 *
 * Both premises can stop being true in a single commit, quietly, by someone who has never read
 * this file — an `<Image>` in a new component, a `remotePatterns` entry to show a broker's
 * logo. That is what these tests are for. If one fails, the reasoning above is void and the
 * upgrade is back on: either take `next@16`, or establish new premises and write them here.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('the premises behind carrying the postcss and sharp advisories', () => {
  it('nothing imports next/image, so sharp decodes nothing', () => {
    const importers = walk(SRC).filter((path) => {
      const source = readFileSync(path, 'utf8');
      // This file names the module in prose; it is the one place that is allowed to.
      if (path.endsWith('dependencies.test.ts')) return false;
      return /from\s+['"]next\/image['"]|require\(['"]next\/image['"]\)/.test(source);
    });

    expect(
      importers.map((path) => path.replace(process.cwd(), '')),
      'next/image is in use now, so sharp is reachable and the advisory needs re-deciding',
    ).toEqual([]);
  });

  it('no remote image host is allowed, so nothing outside this repo is fetched to decode', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

    // `remotePatterns` and the older `domains` both do the same thing: hand the optimiser a
    // host it will fetch bytes from and pass to libvips.
    expect(config).not.toMatch(/remotePatterns/);
    expect(config).not.toMatch(/images\s*:\s*\{[^}]*domains/);
  });
});
