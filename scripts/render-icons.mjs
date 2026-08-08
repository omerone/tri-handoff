/**
 * Rasterises `src/app/icon.svg` into the PNGs that iOS and Android need.
 *
 * iOS ignores an SVG favicon when it puts something on the Home Screen. Without a PNG
 * `apple-touch-icon` it draws a grey rounded square with the first letter of the title in it,
 * which is what "Add to Home Screen" was offering: a capital T where the mark should be.
 *
 * A script rather than three hand-made files. `icon.svg` already carries a note that it and
 * `components/brand/logo.tsx` are kept in step by hand — two copies of one drawing is a
 * standing invitation to change one of them. Three would be worse, and a binary is the copy
 * nobody notices has gone stale, because a PNG does not show up in a diff.
 *
 *     node scripts/render-icons.mjs
 *
 * Two changes are made to the source on the way through, and both are about where the result
 * is drawn rather than about the mark:
 *
 *   - **The corners are squared off.** iOS masks the icon to its own squircle and Android to
 *     whatever the launcher uses. Rounded corners inside that mask leave the tile's dark
 *     shoulders sitting in the rounding — the icon looks like a picture of a rounded square
 *     rather than a rounded icon.
 *   - **The hairline border goes.** It sits one and a half pixels from the edge, which is
 *     exactly the band those masks cut off, so it survives only in patches.
 *
 * Everything else — the ground colour, the zero line, the four days and their spacing — comes
 * straight from the SVG, so a change to the mark reaches the Home Screen by re-running this.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const source = fileURLToPath(new URL('src/app/icon.svg', root));

/** 180 is what Apple asks for; the manifest sizes are the two Android looks for. */
const TARGETS = [
  { path: 'src/app/apple-icon.png', size: 180 },
  { path: 'public/icon-192.png', size: 192 },
  { path: 'public/icon-512.png', size: 512 },
];

const svg = await readFile(source, 'utf8');

const fullBleed = svg
  // The ground, which is the only rect with a corner radius worth having at this size.
  .replace('<rect width="48" height="48" rx="12"', '<rect width="48" height="48"')
  // The hairline, identified by the one thing only it has.
  .replace(/\n *<rect[^>]*stroke="#fff"[^>]*\/>/, '');

if (fullBleed === svg) {
  throw new Error(
    'Neither the rounded ground nor the hairline was found in icon.svg — the two edits this ' +
      'script makes are written against markup that has since changed. Read the file and fix ' +
      'them rather than shipping an icon that is silently still rounded.',
  );
}

for (const { path, size } of TARGETS) {
  const out = fileURLToPath(new URL(path, root));
  const png = await sharp(Buffer.from(fullBleed), { density: 600 })
    .resize(size, size)
    // Flattened onto the mark's own ground. iOS composites transparency against black, which
    // is close enough to this colour to hide the mistake on a dark tile and not close enough
    // anywhere else — better to have no transparency to composite.
    .flatten({ background: '#0b0f14' })
    .png()
    .toBuffer();
  await writeFile(out, png);
  console.log(`${path} — ${size}x${size}, ${(png.length / 1024).toFixed(1)} kB`);
}
