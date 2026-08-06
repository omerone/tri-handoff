import { expect, test } from '@playwright/test';

/**
 * That the analytics page stops growing.
 *
 * It did not, for one deploy. The breakdown charts had been given `flex-1` so a short card
 * would spend its spare height on a taller plot instead of blank surface — and
 * `ResponsiveContainer` measures its parent and writes a height onto its child, the parent
 * was sized by the grid row, and the row was sized by content that had just got taller. Every
 * frame added a few pixels. Measured against production at 1440 wide: 3,122px, then 3,189,
 * then 3,268, still climbing four seconds after load.
 *
 * Nothing else caught it. Types were fine, every unit test passed, and a screenshot taken the
 * moment the page settles looks correct — the bug only exists across time, so the only way to
 * see it is to measure the same page twice and compare.
 *
 * The assertion is that the height does not change at all between samples, not that it stays
 * under some ceiling. A page that grows by two pixels a second is the same defect as one that
 * grows by forty; a limit would only decide how long it took to notice.
 */

const SAMPLES = 5;
const GAP_MS = 600;

test.skip(({ isMobile }) => !!isMobile, 'one viewport is enough to catch a feedback loop');

test('the analytics page settles at one height and stays there', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/analytics');
  await page.waitForLoadState('networkidle');

  const heights: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    await page.waitForTimeout(GAP_MS);
    heights.push(await page.evaluate(() => document.documentElement.scrollHeight));
  }

  expect(new Set(heights).size, `page height over time: ${heights.join(' → ')}`).toBe(1);
});
