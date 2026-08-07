import { expect, test, type Page } from '@playwright/test';

/**
 * Picking rows to delete, which starts by asking.
 *
 * The bulk delete arrived with a tick box on every row and one in the header, always drawn.
 * That put the loudest control on the screen in the first column of a table whose job is to be
 * read — a column of empty boxes reads as something to fill in, and the one thing it does is
 * destructive. So the boxes are behind a button now, and the button is off when the page
 * loads.
 *
 * Two properties, and the second is the one worth writing down: the boxes must be *absent*
 * rather than hidden, because a column that is merely emptied keeps its width and leaves a
 * blank gutter for a mode nobody is in; and leaving the mode has to drop the selection, or a
 * later press brings back an action bar armed with rows chosen minutes ago and no longer
 * visible.
 */

/*
 * Visible ones only, and that is not a detail.
 *
 * The trades screen renders the table and the phone list both, each hiding the other with a
 * breakpoint — so an unfiltered locator counts every row twice and `.first()` lands on a box
 * that is on the page but not on the screen, which `.check()` waits thirty seconds to click.
 */
const boxes = (page: Page) => page.locator('main input[type="checkbox"]').filter({ visible: true });

/** The rows this viewport is actually showing. */
const visibleRows = (page: Page, isMobile: boolean) =>
  page.locator(isMobile ? 'main ul > li' : 'tbody tr').filter({ visible: true });

test.describe('choosing rows to delete', () => {
  test('draws no tick boxes until they are asked for', async ({ page }) => {
    await page.goto('/trades?range=max');
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
    await expect(boxes(page), 'the table arrived in selection mode').toHaveCount(0);
  });

  test('shows every row a box once the button is pressed, and takes them away again', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/trades?range=max');
    const rows = await visibleRows(page, !!isMobile).count();
    expect(rows, 'no rows to pick from').toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Select' }).click();

    // One per row, plus the header's select-all — which the phone list does not have.
    await expect(boxes(page)).toHaveCount(isMobile ? rows : rows + 1);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(boxes(page), 'the boxes were hidden rather than removed').toHaveCount(0);
  });

  test('forgets what was picked when the mode is left', async ({ page }) => {
    /*
     * The failure this prevents is quiet: a row stays ticked while its box is no longer drawn,
     * so the next press of the button reopens an action bar offering to delete something the
     * trader chose before they changed their mind and cannot now see.
     */
    await page.goto('/trades?range=max');
    await page.getByRole('button', { name: 'Select' }).click();

    await boxes(page).first().check();
    await expect(page.getByRole('button', { name: /Delete/ })).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Select' }).click();

    await expect(
      page.getByRole('button', { name: /Delete/ }),
      'a selection survived leaving the mode',
    ).toHaveCount(0);
    await expect(boxes(page).first()).not.toBeChecked();
  });

  test('select-all takes the rows on the page and no more', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the header box lives in the table, which a phone replaces with a list');

    await page.goto('/trades?range=max');
    const rows = await visibleRows(page, false).count();
    await page.getByRole('button', { name: 'Select' }).click();

    await page.locator('thead input[type="checkbox"]').check();
    await expect(page.getByText(new RegExp(`${rows}\\s+rows? selected`, 'i'))).toBeVisible();

    // And back off, from the same box.
    await page.locator('thead input[type="checkbox"]').uncheck();
    await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  });
});
