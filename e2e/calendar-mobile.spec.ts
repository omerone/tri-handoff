import { expect, test } from '@playwright/test';

/**
 * The calendar at two sizes, and the focus ring on the tab that leads to it.
 *
 * A month grid is good at one thing — the shape of the month, which days were traded and which
 * were not — and on a phone it was being asked for two. A square is about fifty-five pixels
 * wide there, and a net, a trade count and a win rate were going into it at a size chosen
 * because nothing larger fitted. The rest sat behind a card that opens on hover, which on a
 * touch screen opens on nothing: `group-hover` needs a pointer and `group-focus-within` needs
 * a focus a tap does not reliably give a `div`. So the numbers were smallest exactly where
 * they were least reachable.
 *
 * Below `md` the squares keep the day and its colour and the numbers move to a list under the
 * grid. What is asserted is that split — figures in the squares on a desktop, figures in the
 * list on a phone, and the same days in both.
 */

test.describe('the calendar on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is the phone layout');

  test('keeps the shape in the grid and the numbers in a list', async ({ page }) => {
    await page.goto('/calendar?m=2026-07');

    const grid = page.locator('main .grid').first();
    await expect(grid).toBeVisible();

    /*
     * `innerText`, not `toContainText`.
     *
     * The desktop figures and the hover card are still in the markup below `md` — hidden by
     * CSS, which is how one component serves both sizes — and `toContainText` reads
     * `textContent`, which does not care. It matched every number on the screen the layout was
     * built to move, and would have passed against the layout it replaced. `innerText` is what
     * is rendered.
     */
    const painted = await grid.innerText();
    expect(painted, 'a figure is still crammed into a square').not.toMatch(/[₪$€£]/);

    const rows = page.locator('main ul > li').filter({ visible: true });
    const count = await rows.count();
    expect(count, 'no day rows under the grid').toBeGreaterThan(0);

    // Every row carries what the square cannot: a date, a figure, and the day's record.
    const first = rows.first();
    await expect(first).toContainText(/[₪$€£]/);
    await expect(first).toContainText(/\d{2}\/\d{2}\/\d{4}/);
    await expect(first).toContainText(/\d+\/\d+/);
  });

  test('lists the days that were traded and no others', async ({ page }) => {
    /*
     * A month has about twenty days with nothing on them. They are already visible as blank
     * squares, and a row apiece would make the list four times as long as the answer in it.
     */
    await page.goto('/calendar?m=2026-07');

    const listed = await page.locator('main ul > li').filter({ visible: true }).count();
    /*
     * A traded day is one that opens. Since the squares became buttons that show the day's
     * trades, that is the same set as "has a dot" and a far more stable thing to name — the
     * dot is markup, and this locator was already reading it through `.grid > div`, which
     * stopped matching the moment a wrapper went round the square.
     */
    const traded = await page.locator('main button[aria-controls][aria-haspopup="dialog"]').count();

    expect(traded, 'no traded days in the grid to compare against').toBeGreaterThan(0);
    expect(listed, 'the list and the grid disagree about which days were traded').toBe(traded);
  });
});

test.describe('the calendar on a desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'this is the wide layout');

  test('keeps the numbers in the squares, with no list under them', async ({ page }) => {
    await page.goto('/calendar?m=2026-07');

    const grid = page.locator('main .grid').first();
    expect(await grid.innerText(), 'the squares lost their figures').toMatch(/[₪$€£]/);
    await expect(
      page.locator('main ul > li').filter({ visible: true }),
      'the phone list is showing on a desktop',
    ).toHaveCount(0);
  });
});

test.describe('the tab that is current', () => {
  test('draws its focus ring around itself, and inside the strip', async ({ page }) => {
    /*
     * Two defects in one frame, both measured rather than looked at.
     *
     * The global focus rule set `border-radius: 6px`, which reads as "round the ring" and is
     * not what it does — an outline already follows the element's own radius, so the
     * declaration overrode it and a tab drawn `rounded-[10px]` changed shape the moment it took
     * focus. And the strip scrolls sideways, which makes the *vertical* axis clip too, so a
     * ring 2px wide at a 2px offset lost four pixels off the top and four off the bottom. What
     * was left read as a frame belonging to something other than the button it was on.
     */
    await page.goto('/calendar');
    const tab = page.locator('nav a[aria-current="page"]');
    await tab.focus();

    const measured = await tab.evaluate((el) => {
      const style = getComputedStyle(el);
      const nav = el.closest('nav')!;
      const box = el.getBoundingClientRect();
      const navBox = nav.getBoundingClientRect();
      const reach = (parseFloat(style.outlineOffset) || 0) + (parseFloat(style.outlineWidth) || 0);
      return {
        radius: parseFloat(style.borderRadius),
        clippedTop: navBox.top - (box.top - reach),
        clippedBottom: box.bottom + reach - navBox.bottom,
      };
    });

    expect(measured.radius, 'the ring overrode the tab’s own corner radius').toBeGreaterThanOrEqual(
      10,
    );
    expect(measured.clippedTop, 'the ring is cut off at the top of the strip').toBeLessThanOrEqual(
      0,
    );
    expect(
      measured.clippedBottom,
      'the ring is cut off at the bottom of the strip',
    ).toBeLessThanOrEqual(0);
  });
});
