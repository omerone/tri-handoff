import { expect, test } from '@playwright/test';

/**
 * Keeping the app on a phone's Home Screen.
 *
 * "Add to Home Screen" offered a grey rounded square with a capital `T` in it, labelled with
 * the whole strapline. iOS ignores an SVG favicon for this and wants a PNG `apple-touch-icon`;
 * there was not one, so it fell back to drawing the first letter of the title.
 *
 * Worth a test because none of it is visible from inside the app. Every one of these is a tag
 * in `<head>` or a file beside it, and the only place the mistake shows up is on somebody's
 * phone, after they have already added it — a binary that stopped being generated leaves no
 * trace in a diff and breaks no page.
 */

test.describe('adding the app to a home screen', () => {
  test('offers the mark, at the size iOS asks for', async ({ page, request }) => {
    await page.goto('/login');

    const icon = page.locator('link[rel="apple-touch-icon"]');
    await expect(icon).toHaveCount(1);
    await expect(icon).toHaveAttribute('sizes', '180x180');

    // The tag can be right while the file behind it is not there at all.
    const href = await icon.getAttribute('href');
    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/png');

    /*
     * A real 180x180 PNG, read out of the header rather than trusted.
     *
     * Bytes 16-23 of a PNG are the width and height, big-endian, straight after the IHDR
     * length and tag. Checking them catches the failure that matters here: a file that is
     * served, and is a PNG, and is the wrong size — which iOS scales into a blurry tile
     * rather than refusing, so nothing anywhere says it is wrong.
     */
    const body = await response.body();
    expect(body.subarray(1, 4).toString()).toBe('PNG');
    expect(body.readUInt32BE(16)).toBe(180);
    expect(body.readUInt32BE(20)).toBe(180);
  });

  test('names itself in the nine characters iOS gives it', async ({ page }) => {
    await page.goto('/login');

    // `title` is the strapline and gets truncated to something like "TRi — Tra…" under the
    // icon. This is what actually appears there.
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
      'content',
      'TRi',
    );
  });

  test('has a manifest that opens on the front door', async ({ page, request }) => {
    await page.goto('/login');

    const link = page.locator('link[rel="manifest"]');
    await expect(link).toHaveCount(1);

    const manifest = await (await request.get((await link.getAttribute('href'))!)).json();
    expect(manifest.short_name).toBe('TRi');
    // Not whichever page they happened to be on when they added it.
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');

    // Both Android sizes, and both actually there.
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes).sort();
    expect(sizes).toEqual(['192x192', '512x512']);
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect((await request.get(icon.src)).status(), `${icon.src} is missing`).toBe(200);
    }
  });
});
