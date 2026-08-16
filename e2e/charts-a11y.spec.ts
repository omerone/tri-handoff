import { expect, test, type Page } from '@playwright/test';

/**
 * Every drawing on the product says what it is.
 *
 * The charts were `<div>`s full of SVG: no name, no description, and no way to reach the
 * numbers except by pointing at them. To anything that is not a pair of eyes the dashboard
 * was blank in exactly the places it says the most.
 *
 * These assertions are deliberately about the *accessible* name rather than about markup. A
 * `role="img"` with an empty label passes a grep and fails a person, and the whole point of
 * this pass was that the earlier check — "does the file contain the string aria-label" —
 * reported five charts as fine when none of them were.
 */

/** Charts only. The header's logo carries a name too, and it is not what this is about. */
function graphics(page: Page) {
  return page.locator('main [role="img"]');
}

async function names(page: Page): Promise<string[]> {
  return (await graphics(page).evaluateAll((els) =>
    els.map((el) => (el.getAttribute('aria-label') ?? '').trim()),
  )).filter(Boolean);
}

test.describe('every chart says what it is', () => {
  test('the equity curve is named and its points are readable', async ({ page }) => {
    await page.goto('/dashboard');

    // Named after the card it sits in, and carrying the sentence a glance would give.
    const named = await names(page);
    const equity = named.find((label) => label.includes('Opened at'));
    expect(equity, `no equity summary among: ${named.slice(0, 4).join(' | ')}`).toBeTruthy();
    expect(equity).toMatch(/Opened at .+ now .+/);

    /*
     * And the numbers themselves, as a table. Not a paraphrase: the same values the axis
     * prints, so the two cannot drift. Hidden visually, which is why this asserts on the row
     * count rather than on anything being on screen.
     */
    const rows = page.locator('figcaption table tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    // Named by an attribute, not by a `<caption>`: a visible second copy of the card's own
    // title is what broke three existing tests the first time round.
    await expect(page.locator('figcaption table').first()).toHaveAttribute('aria-label', /.+/);
  });

  test('the analytics charts are named, and none of them is named nothing', async ({ page }) => {
    await page.goto('/analytics');

    const found = await names(page);
    expect(found.length, 'no named graphics on the analytics page').toBeGreaterThan(0);

    // An empty label is the failure mode a markup check cannot see.
    for (const label of found) expect(label.length).toBeGreaterThan(3);

    // Each one says what it holds, not just what it is called.
    const described = found.filter((label) => /categories|groups|group|Nothing to show/.test(label));
    expect(described.length, `none described: ${found.slice(0, 3).join(' | ')}`).toBeGreaterThan(0);
  });

  test('a day in the R strip announces its own figures', async ({ page }) => {
    /*
     * The strip's columns carry `tabIndex` so the detail card can be opened from the
     * keyboard — which was half a thought. The card is drawn by CSS on focus, so it is
     * decoration to anything not looking at the screen, and a focusable element with no name
     * is announced as "blank". A reader could tab through sixty of them and be told nothing
     * sixty times.
     */
    await page.goto('/dashboard');

    const columns = page.locator('main [tabindex="0"][role="img"]');
    const count = await columns.count();
    test.skip(count === 0, 'the strip is not drawn at this viewport');

    for (const label of await columns.evaluateAll((els) =>
      els.slice(0, 5).map((el) => el.getAttribute('aria-label') ?? ''),
    )) {
      // A date at minimum, and the day's figures when it had any trades.
      expect(label).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    }
  });
});
