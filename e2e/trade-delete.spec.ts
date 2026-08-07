import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * Ticking rows and removing them, through the table a person actually uses.
 *
 * What the action does with a list of ids is covered against the database in
 * tests/integration/bulk-delete.test.ts. What only exists in the browser is everything before
 * that: whether a row can be ticked at all, whether the bar appears and counts correctly, and
 * whether the delete reaches the server and the row is gone afterwards.
 *
 * It works on rows it creates itself and nothing else. The seeded book is shared with every
 * other spec in this suite, and a test that deleted from it would be quietly changing the
 * numbers those specs assert on.
 */

const SYMBOL = 'E2EDEL';

async function removeOwnRows() {
  const prisma = new PrismaClient();
  try {
    await prisma.trade.deleteMany({ where: { symbol: SYMBOL } });
  } finally {
    await prisma.$disconnect();
  }
}

test.beforeAll(removeOwnRows);
test.afterAll(removeOwnRows);

/** `dd/mm/yyyy`, the one order every date field on this product reads. */
function displayDate(daysAgo: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - daysAgo);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
}

test('ticks two rows and removes them together', async ({ page }) => {
  // Two hand-entered rows, so the test owns everything it is about to delete.
  for (const [index, profit] of [
    [1, '120'],
    [2, '-45'],
  ] as const) {
    await page.goto('/long?book=day');
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="symbol"]') })
      .first();
    await form.locator('input[name="symbol"]').fill(SYMBOL);
    await form.locator('input[placeholder="dd/mm/yyyy"]').first().fill(displayDate(index));
    await form.locator('input[name="profit"]').fill(profit);
    await form.locator('input[name="risk"]').fill('100');
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(form.getByText('Trade added.')).toBeVisible();
  }

  await page.goto('/trades?range=max');

  /*
   * The table and the card list hide each other by viewport, so both carry the row and only
   * one is on screen. Filtering to what is visible is what lets this spec run at both sizes —
   * see the note in manual-trade.spec.ts.
   */
  const rows = page.locator('tbody tr, li').filter({ hasText: SYMBOL }).filter({ visible: true });
  await expect(rows).toHaveCount(2);

  // Ask for the boxes. They are not drawn until this is pressed — a column of tick boxes on a
  // table nobody came here to edit is the loudest control on the screen, and the one thing it
  // does is destructive. See trade-selection.spec.ts for that behaviour on its own.
  await page.getByRole('button', { name: 'Select' }).click();

  await rows.nth(0).locator('input[type="checkbox"]').check();
  await rows.nth(1).locator('input[type="checkbox"]').check();

  // The bar reports what is picked, and says "2" rather than the whole page.
  await expect(page.getByText('2 rows selected')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(rows).toHaveCount(0);
  // And the bar goes with them, rather than reporting a selection of rows that no longer exist.
  await expect(page.getByText('rows selected')).toHaveCount(0);
});

test('select-all reaches this page and no further', async ({ page }) => {
  await page.goto('/trades?range=max');

  /*
   * Desktop only: the card list has no header to hang a select-all on.
   *
   * Filtered to what is *visible*, not to what exists. Below the tablet breakpoint the table
   * is still in the DOM behind `hidden md:block`, so counting elements finds the header box on
   * a phone and then waits thirty seconds to click something nobody can see.
   */
  const header = page.locator('thead input[type="checkbox"]').filter({ visible: true });
  test.skip((await header.count()) === 0, 'no table header at this viewport');

  const onPage = await page.locator('tbody tr').count();
  await header.check();

  /*
   * The page, not the book. The pager below says how many more there are, and a control that
   * silently reached past what is on screen is how someone removes a year of history meaning
   * to remove a morning of it.
   */
  await expect(page.getByText(`${onPage} rows selected`)).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByText('rows selected')).toHaveCount(0);
});
