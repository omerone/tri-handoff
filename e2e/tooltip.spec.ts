import { expect, test, type Page } from '@playwright/test';

/**
 * The hover hints on icon controls.
 *
 * These were `title` attributes, which meant the browser drew them on its own schedule — well
 * over a second on macOS, and not adjustable from the page at any price. The replacement is in
 * src/components/ui/tooltip.tsx. Two things are worth a browser to check, and neither can be
 * seen from a unit test.
 *
 * The first is the timing, which is the entire reason the component exists. Asserting the hint
 * is visible inside 400ms is the assertion: the native tooltip could never pass it, so if this
 * ever regresses to `title` the test fails rather than silently going back to a three-second
 * wait nobody notices in review.
 *
 * The second is that no native tooltip is left anywhere. A control carrying both `data-tip`
 * and `title` shows two hints at two different moments, which is worse than either alone — so
 * the sweep across the app's screens counts `[title]` and expects nothing.
 */

// Hover is a pointer affordance. On a touch screen `pointerover` fires on tap, and a hint that
// appears under the finger that is already pressing the button is noise — those users get the
// control's own `aria-label`, which every one of them carries. Nothing to assert here.
test.skip(({ isMobile }) => !!isMobile, 'hover hints are for pointers');

// By the layer's own attribute, not by `role="tooltip"`: the charts on the dashboard render
// three dozen nodes with that role, and matching them all would make this test meaningless.
const tooltip = (page: Page) => page.locator('[data-tri-tip]');

test.describe('hover hints', () => {
  test('appear in a fraction of the time the browser took', async ({ page }) => {
    await page.goto('/finance');

    // Whichever control the screen happens to lead with: the point is the mechanism, not any
    // one button, and pinning this to a particular icon would make it a layout test.
    const control = page.locator('[data-tip]').first();
    await expect(control).toBeVisible();
    const text = await control.getAttribute('data-tip');
    expect(text?.trim()).toBeTruthy();

    await control.hover();
    // Four hundred milliseconds against the ~1s+ the browser used, and the delay in the
    // component is 90 — this fails loudly if the hint ever goes back to being the native one.
    await expect(tooltip(page)).toBeVisible({ timeout: 400 });
    await expect(tooltip(page)).toHaveText(text!.trim());
  });

  test('leave with the pointer, and on a press', async ({ page }) => {
    await page.goto('/finance');

    // A KPI tile rather than a button: pressing it does nothing, which is what makes the
    // press assertion below about the hint and not about whatever the button went on to do.
    const control = page.locator('main div[data-tip]').first();
    await control.hover();
    await expect(tooltip(page)).toBeVisible({ timeout: 400 });

    // Somewhere with nothing under it. `pointerout` is what carries this, and moving inside
    // the control — over the icon within the button — must not count as leaving.
    await page.mouse.move(2, 2);
    await expect(tooltip(page)).toBeHidden();

    // A press hides it, and it stays down while the pointer rests there. Clicking a row's
    // delete button removes the row and no `pointerout` ever arrives from an element that no
    // longer exists, so without this the bubble is left pointing at a gap.
    await control.hover();
    await expect(tooltip(page)).toBeVisible({ timeout: 400 });
    await page.mouse.down();
    await expect(tooltip(page)).toBeHidden();
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toBeHidden();
  });

  test('stay inside the viewport at the edges of the screen', async ({ page }) => {
    await page.goto('/dashboard');

    // The header controls sit at the very top and hard against one edge, which is where a
    // bubble centred on its control and placed above it would be drawn off-screen.
    const header = page.locator('header [data-tip]');
    const count = await header.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await header.nth(i).hover();
      await expect(tooltip(page)).toBeVisible({ timeout: 400 });

      const box = (await tooltip(page).boundingBox())!;
      const size = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);

      await page.mouse.move(2, 2);
      await expect(tooltip(page)).toBeHidden();
    }
  });

  test('are the only hints — no native tooltip survives anywhere', async ({ page }) => {
    for (const path of ['/dashboard', '/trades', '/finance', '/long', '/calendar', '/analytics']) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      expect(await page.locator('[title]').count(), `native title= on ${path}`).toBe(0);
    }
  });
});
