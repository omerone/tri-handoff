import { expect, test, type Page } from '@playwright/test';

/**
 * The broker card, measured rather than looked at.
 *
 * Two things went wrong on it and neither is the kind a scroll-width check finds, because
 * neither pushed the *page* out. The read-only badge — one unbreakable run of text in a row
 * that could only shrink — ran through its own card border and printed on top of the slot
 * beside it. And the three figures at the foot of the card sat in `1fr` grid tracks, which are
 * allowed to be narrower than their contents, so the sync time was drawn across the balance.
 * Both of those are legible-looking nonsense: real text, in the right place, overlapping.
 *
 * The cause was the same in both cases and is worth naming, because it will happen again: this
 * card lives in one half of a two-column page, so its width has almost nothing to do with the
 * width of the screen. `sm:grid-cols-2` was satisfied on a 1280px desktop that gave each slot
 * 230 pixels — narrower than a phone. So these run on both viewports, and what they assert is
 * containment and separation, not a breakpoint.
 */

/** Every box inside `root` that is drawn outside it. */
async function escapedFrom(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(the card is not on the page)'];
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll('*')]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        // A pixel of slack: borders and sub-pixel layout are not defects.
        return box.right > bounds.right + 1 || box.left < bounds.left - 1;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`);
  }, selector);
}

/** Pairs of figures whose boxes intersect — two numbers drawn over one another. */
async function overlappingFigures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll('main dl .tri-num')]
      .map((el) => ({ text: (el.textContent ?? '').trim(), r: el.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0 && b.r.height > 0);

    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!.r;
        const b = boxes[j]!.r;
        const overlaps =
          a.left < b.right - 1 &&
          b.left < a.right - 1 &&
          a.top < b.bottom - 1 &&
          b.top < a.bottom - 1;
        if (overlaps) hits.push(`"${boxes[i]!.text}" over "${boxes[j]!.text}"`);
      }
    }
    return hits;
  });
}

test.describe('the connected broker card', () => {
  test('shows the account, the read-only badge and the three figures', async ({ page }) => {
    // What the card is for. The geometry below only matters if these are on it.
    await page.goto('/settings');
    const slot = page.locator('section:has(dl)').first();

    await expect(slot.getByText(/investor|Investor|קריאה/).first()).toBeVisible();
    await expect(slot.locator('dt')).toHaveCount(3);
    await expect(slot.locator('.tri-num').first()).toBeVisible();
  });

  test('holds together at every width, not just the two we usually look at', async ({ page }) => {
    /*
     * One loop rather than a test per property, because the properties only break together and
     * only at particular widths.
     *
     * The original defect was invisible at both viewports the suite runs: the mobile project is
     * a 412px Pixel and the desktop one is wide enough that the card is roomy. It appeared in
     * between — this card sits in one half of a two-column page, so its width has almost
     * nothing to do with the screen's, and the slot inside it was 230px on a 1280px desktop.
     * Checking the two ends of the range is what let a broken card through a green suite, so
     * the range is what gets checked.
     */
    for (const width of [1280, 1024, 900, 768, 600, 414, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/settings');
      await expect(page.locator('main dl .tri-num').first()).toBeVisible();

      expect(await escapedFrom(page, 'section:has(dl)'), `escaped its card at ${width}px`).toEqual(
        [],
      );
      expect(await overlappingFigures(page), `figures overlapped at ${width}px`).toEqual([]);

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(sideways, `the settings page scrolls sideways at ${width}px`).toBe(false);
    }
  });
});
