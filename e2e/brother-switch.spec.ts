import { expect, test, type Page } from '@playwright/test';

/**
 * The brother switch: one login, two people, and a header control deciding whose money and
 * whose hours the owned screens show.
 *
 * Trading is joint on purpose — the reason the product is a single tenant — so the switch must
 * do exactly two things and no third: swap the finance and learning data between יוני and
 * אביתר, and visibly stand down on the screens where the data is shared.
 *
 * Titles are unique per run because both ledgers accumulate across runs; the names cannot be,
 * because they are the two fixed brothers. So every assertion is about presence of this run's
 * rows, never about totals arithmetic that older runs would drift.
 */

const run = Date.now().toString(36).slice(-5);

/**
 * A switch position by name. The brothers' names are names and never translate; the third
 * position is a label and does — the seeded e2e user reads English, a real one Hebrew.
 */
const flip = (page: Page, name: string | RegExp) =>
  page
    .getByRole('group', { name: /whose data|של מי הנתונים/i })
    .getByRole('button', { name, exact: typeof name === 'string' });

test.describe('the brother switch', () => {
  test('swaps the budget between the brothers, and "both" holds everything', async ({ page }) => {
    const yoni = `חשמל ${run}`;
    const evyatar = `דלק ${run}`;

    // Everything visible while the switch rests on "both".
    await page.goto('/finance');
    await flip(page, /^both$|^שניהם$/i).click();

    const add = async (owner: string, label: string) => {
      const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
      if (await opener.isVisible().catch(() => false)) await opener.click();
      // By role: the switch's group carries an aria-label that also says 'whose', and a bare
      // label match resolves to both.
      await page.getByRole('combobox', { name: /whose|של מי/i }).selectOption(owner);
      await page.getByLabel(/label|תיאור/i).fill(label);
      await page.getByLabel(/amount|סכום/i).fill('120');
      await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
      await expect(page.getByText(label).first()).toBeVisible();
    };

    await add('יוני', yoni);
    await add('אביתר', evyatar);

    // Narrowed to one brother, the other's money is gone from the screen.
    await flip(page, 'יוני').click();
    await expect(page.getByText(yoni).first()).toBeVisible();
    await expect(page.getByText(evyatar)).toHaveCount(0);

    await flip(page, 'אביתר').click();
    await expect(page.getByText(evyatar).first()).toBeVisible();
    await expect(page.getByText(yoni)).toHaveCount(0);

    // And the position survives a reload — it is a cookie, not client state.
    await page.reload();
    await expect(page.getByText(evyatar).first()).toBeVisible();
    await expect(page.getByText(yoni)).toHaveCount(0);
  });

  test('follows the same position on the study ledger', async ({ page }) => {
    const title = `קריאת גרפים ${run}`;

    await page.goto('/learning');
    await flip(page, 'יוני').click();

    const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
    if (await opener.isVisible().catch(() => false)) await opener.click();
    // The learner select already defaults to the switch's position — that is the point.
    await expect(page.getByLabel(/who studied|מי למד/i)).toHaveValue('יוני');
    await page.getByLabel(/^what|מה נלמד/i).fill(title);
    await page.getByLabel(/^hours|שעות/i).first().fill('2');
    await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    // The other brother's view does not hold this session.
    await flip(page, 'אביתר').click();
    await expect(page.getByText(title)).toHaveCount(0);

    await flip(page, /^both$|^שניהם$/i).click();
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('stands down on the trading screens instead of pretending to filter', async ({ page }) => {
    await page.goto('/trades');
    const group = page.getByRole('group', { name: /whose data|של מי הנתונים/i });
    await expect(group, 'the switch is missing from the header').toBeVisible();

    // Dimmed and captioned: the wrapper says trading is shared. A pressed name that silently
    // changed nothing would read as data loss the first time somebody noticed.
    const wrapper = page.locator('form[data-tip]').filter({ has: group });
    await expect(wrapper).toHaveCount(1);
  });
});
