import { expect, test, type Page } from '@playwright/test';

/**
 * The range picker at two sizes.
 *
 * On a phone it was a huddle of buttons at one end of an empty row, right-aligned because the
 * desktop shares that row with the tabs and needs them out of the way. At 360px the huddle no
 * longer fitted and took a second line. And the summary — the one thing that says which dates
 * are actually being read — was `hidden md:inline`, so the screen with no room for the custom
 * button's own label was also the screen that never said what the custom range was. Three
 * unlit presets and no way to tell what you were looking at without opening the popover.
 *
 * Below `md` the presets take the width and split it evenly, the custom trigger is an icon, and
 * the summary sits under them on its own line. Above `md` none of that applies.
 */

/** The preset segment buttons, which are the ones inside the labelled group. */
const presets = (page: Page) => page.locator('[role="group"][aria-label] button');

const widthsOf = async (page: Page) =>
  presets(page).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));

test.describe('the range picker on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is the phone layout');

  test('gives every preset the same share of the row', async ({ page }) => {
    await page.goto('/trades');
    const widths = await widthsOf(page);
    expect(widths.length, 'no presets found').toBeGreaterThan(1);

    // Equal to the pixel is not the claim — sub-pixel rounding is real. Within two is.
    const spread = Math.max(...widths) - Math.min(...widths);
    expect(
      spread,
      `the presets are still sized by their labels: ${widths.join(', ')}`,
    ).toBeLessThanOrEqual(2);
  });

  test('stays on one line at the narrowest phone worth supporting', async ({ page }) => {
    /*
     * 360px is where it used to wrap: three Hebrew labels and a seventy-nine-pixel "custom
     * range" do not go on one line, and the second line pushed every screen's content down.
     */
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/trades');

    const row = presets(page)
      .first()
      .locator('xpath=ancestor::div[contains(@class,"flex-wrap")][1]');
    const height = await row.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    // One row of controls, plus the summary line when there is one. Two lines of *buttons*
    // would be about eighty.
    expect(height, 'the picker wrapped onto a second line of buttons').toBeLessThan(70);
  });

  test('says which dates are being read', async ({ page }) => {
    // The gap this closes: on a phone the custom trigger is an icon, so without this line
    // nothing on the screen names the range.
    await page.goto('/trades?range=2026-06-01..2026-07-31');
    const summary = page.locator('span[dir="ltr"]').filter({ hasText: /\d{2}\/\d{2}\/\d{4}/ });
    await expect(summary.first(), 'the active range is not named anywhere').toBeVisible();
  });
});

test.describe('the range picker on a desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'this is the wide layout');

  test('keeps its labels and its natural widths', async ({ page }) => {
    await page.goto('/trades');

    // The custom trigger says what it is here; on a phone it is the calendar icon.
    await expect(page.getByRole('button', { name: /custom|מותאם/i })).toContainText(/\w|\S/);

    const widths = await widthsOf(page);
    const spread = Math.max(...widths) - Math.min(...widths);
    expect(spread, 'the desktop presets were stretched to match each other').toBeGreaterThan(2);
  });
});
