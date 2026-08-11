import { expect, test, type Page } from '@playwright/test';

/**
 * The range picker, which is two controls wearing one name.
 *
 * From `lg` it is a segmented row of presets with a custom trigger beside it and the range
 * spelled out after that — a shape that needs about four hundred and thirty pixels and has
 * them. Below `lg` it is one button that *reads the current range*, and every way to change it
 * lives in a panel behind it.
 *
 * The narrow layout is the interesting half and the reason is worth stating: a picker's default
 * state should answer "what am I looking at", not offer four ways to change it. The old one did
 * the opposite — three unlit preset buttons and, on a phone, nothing at all naming the range
 * they were unlit against.
 *
 * The breakpoint is `lg`, not `md`, because `md` *is* 768: a tablet at exactly that width got
 * the wide layout with nothing to spare, tabs cut off on one side and the picker filling the
 * rest. That was the screenshot that prompted this.
 */

const trigger = (page: Page) => page.locator('button[aria-controls="tri-range-custom"]');
const sheet = (page: Page) => page.locator('#tri-range-custom');
/**
 * The segmented preset row, which is drawn only in the wide layout.
 *
 * By what is visible, not by a class string: both layouts are in the markup at every width and
 * CSS decides which one is painted, so `form:not([class*="lg:hidden"])` — the first version of
 * this — matched the wide row on a phone and called the layout broken.
 */
const segmented = (page: Page) =>
  page
    .locator('[role="group"]')
    .filter({ has: page.getByRole('button', { name: /last month|חודש קודם/i }) })
    .filter({ visible: true });

test.describe('the range picker on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is the narrow layout');

  test('reads the current range rather than offering four ways to change it', async ({ page }) => {
    await page.goto('/trades?range=max');
    await expect(trigger(page), 'the trigger does not name the active range').toContainText(
      /maximum|מקסימום/i,
    );
    await expect(segmented(page), 'the segmented row is still on a phone').toHaveCount(0);

    // A custom range names itself by its dates, which is the thing a preset label cannot say.
    await page.goto('/trades?range=2026-06-01..2026-07-31');
    await expect(trigger(page)).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  });

  test('opens a panel holding every option, presets included', async ({ page }) => {
    await page.goto('/trades?range=max');
    await expect(sheet(page), 'the panel is open before it was asked for').toHaveCount(0);

    await trigger(page).click();
    const panel = sheet(page);
    await expect(panel).toBeVisible();

    // Both halves: the three presets, and the custom range under them.
    for (const preset of [/maximum|מקסימום/i, /this month|החודש/i, /last month|חודש קודם/i]) {
      await expect(panel.getByRole('button', { name: preset })).toBeVisible();
    }
    await expect(panel.getByRole('button', { name: /apply|החל/i })).toBeVisible();

    // And it animates open rather than appearing — the class carries it, and
    // `prefers-reduced-motion` turns it off with everything else.
    await expect(panel).toHaveClass(/tri-sheet/);
  });

  test('a preset picked in the panel becomes the range the trigger reads', async ({ page }) => {
    await page.goto('/trades?range=max');
    await trigger(page).click();
    await sheet(page)
      .getByRole('button', { name: /this month|החודש/i })
      .click();

    await expect(trigger(page), 'the trigger did not follow the choice').toContainText(
      /this month|החודש/i,
    );
    await expect(sheet(page), 'the panel stayed open over the answer').toHaveCount(0);
  });
});

test.describe('the range picker on a desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'this is the wide layout');

  /**
   * One door at every width.
   *
   * A segmented row of presets used to sit beside the trigger here, which made the trigger the
   * *other* way in and left it reading "Custom range" — a control naming one of its options
   * rather than its answer. Two layouts also meant two places a preset could live and two
   * shapes to keep in agreement. The narrow layout had already settled what this should be.
   */
  test('reads the range, and keeps every option behind it', async ({ page }) => {
    await page.goto('/trades?range=max');

    await expect(
      segmented(page).first(),
      'the segmented row is back beside the trigger',
    ).toHaveCount(0);
    await expect(trigger(page), 'the trigger does not read the active range').toHaveText(
      /maximum|מקסימום/i,
    );

    await trigger(page).click();
    const panel = sheet(page);
    await expect(panel).toBeVisible();
    // Every way to change the range, in the one place that opens.
    await expect(panel.getByRole('button', { name: /last month|חודש קודם/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /apply|החל/i })).toBeVisible();
  });

  test('does not open itself when a shared link lands on a custom range', async ({ page }) => {
    // It used to, so the fields that produced the link were on screen. With the trigger now
    // saying what the range is, that is a menu covering the page nobody asked to see.
    await page.goto('/trades?range=2026-03');
    await expect(sheet(page), 'the panel opened on its own').toHaveCount(0);
  });
});
