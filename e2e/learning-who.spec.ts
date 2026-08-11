import { expect, test, type Page } from '@playwright/test';

/**
 * Two people share the login, so the study ledger has to answer for each of them.
 *
 * "Eleven hours this month" is a good month or it is one of them carrying it, and those are
 * different situations — the whole reason a name is recorded against a session. A per-person
 * card alone would not settle it either: the figures at the top and the donut beside them
 * would still be describing the pair, which is the question nobody asked.
 *
 * Names are unique per run. The ledger is not cleared between runs, so a fixed "Ester" would
 * accumulate hours from every previous one and the totals below would drift — and, worse, the
 * assertions would pass or fail depending on how many times the file had been run before.
 * A name nobody else used makes every figure here exactly this run's arithmetic.
 */

const run = Date.now().toString(36).slice(-5);
const ESTER = `Ester-${run}`;
const SHIMON = `Shimon-${run}`;

/**
 * The KPI tile's value, and only the tile's.
 *
 * The donut repeats the same label in its centre, so a bare text match resolves to both and
 * strict mode rightly refuses to pick. The tile is the first of the four in the grid, which is
 * a stable fact about the layout rather than a guess about the markup.
 */
const totalHours = (page: Page) =>
  page.getByText(/total hours|סך שעות/i).first().locator('..');

async function addSession(page: Page, who: string, hours: string, title: string) {
  await page.goto('/learning');
  /*
   * On a phone the form lives behind an 'Add an entry' sheet; on a desktop it is inline and
   * the same button exists but is hidden. Matching the exact sheet label keeps this from
   * grabbing some other button whose name merely contains 'add'.
   */
  const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
  if (await opener.isVisible().catch(() => false)) await opener.click();

  await page.getByLabel(/who studied|מי למד/i).fill(who);
  await page.getByLabel(/^what|מה נלמד/i).fill(title);
  await page.getByLabel(/^hours|שעות/i).first().fill(hours);
  await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
  await expect(page.getByText(title).first()).toBeVisible();
}

test.describe('the study ledger, per person', () => {
  test('narrows every figure on the screen, not only the comparison card', async ({ page }) => {
    const mine = `tape ${run}`;
    const theirs = `sizing ${run}`;
    await addSession(page, ESTER, '3', mine);
    await addSession(page, SHIMON, '1', theirs);

    // Both, which is the default.
    await page.goto('/learning');
    await expect(page.getByText(mine).first()).toBeVisible();
    await expect(page.getByText(theirs).first()).toBeVisible();

    // One of them. The totals follow the tab rather than only a card further down — and
    // because the name is this run's, three hours is the whole of what that person has.
    await page.getByRole('link', { name: ESTER, exact: true }).click();
    await expect(page.getByText(mine).first()).toBeVisible();
    await expect(
      page.getByText(theirs),
      "the other person's session is still listed",
    ).toHaveCount(0);
    await expect(totalHours(page), 'the headline hours still describe the pair').toContainText(
      '3',
    );

    // In the URL, so it survives a reload and can be sent to the other person.
    await page.reload();
    await expect(page).toHaveURL(/who=/);
    await expect(totalHours(page)).toContainText('3');
  });

  test('keeps the comparison for the view that is a comparison', async ({ page }) => {
    await addSession(page, ESTER, '2', `risk ${run}`);
    await addSession(page, SHIMON, '5', `journalling ${run}`);

    await page.goto('/learning');
    const card = page.getByText(/hours per person|שעות לפי אדם/i);
    await expect(card, 'the comparison is missing when both are shown').toBeVisible();

    // Narrowed to one person it would be a table with a single row restating the tiles above.
    await page.getByRole('link', { name: SHIMON, exact: true }).click();
    await expect(card).toHaveCount(0);
  });
});
