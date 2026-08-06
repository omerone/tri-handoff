import { expect, test } from '@playwright/test';

/**
 * Every panel on the analytics screen folds shut on a phone, and none of them does on a desktop.
 *
 * Fifteen charts stacked open came to five thousand pixels — six screens to reach the last
 * one, and no way to see what the page even offers without scrolling through all of it. Folded,
 * the whole screen is an index of titles you tap the one you want out of.
 *
 * Both halves are asserted here because each is a way for this to be wrong. Left open on a
 * phone it is the scroll it was meant to remove; folded on a desktop it is a disclosure on a
 * screen with room to show everything at once, which is a click charged for nothing.
 */

test.describe('folding', () => {
  test('starts folded on a phone and opens what is tapped', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    /*
     * Hidden, not absent. `CollapsibleCard` folds with `hidden md:block` rather than
     * unmounting, so every chart is still in the DOM and a `count()` here reads nine — which
     * is what this assertion said first, and it was wrong about the component rather than
     * about the behaviour. What matters to someone holding a phone is whether it takes up the
     * screen, and that is visibility.
     */
    await expect(page.locator('.recharts-responsive-container').first()).toBeHidden();

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewport = page.viewportSize()!.height;
    expect(height / viewport, `folded, the page is ${height}px`).toBeLessThan(3);

    // The disclosure is the panel's own header, not a separate control beside it.
    const panel = page.locator('button[aria-expanded]', { hasText: 'P&L by weekday' }).first();
    await expect(panel).toHaveAttribute('aria-expanded', 'false');
    await panel.click();
    await expect(panel).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
  });

  test('is always open on a desktop, with nothing to press', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/analytics');
    await page.waitForLoadState('networkidle');

    // Every chart drawn without a click. The disclosure buttons are in the DOM — the two
    // headers are rendered together and CSS chooses — but none of them is on screen.
    expect(await page.locator('.recharts-responsive-container').count()).toBeGreaterThan(4);
    await expect(page.locator('button[aria-expanded]', { hasText: 'P&L by weekday' })).toBeHidden();
  });
});
