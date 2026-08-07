import { expect, test } from '@playwright/test';
import { openAddForm } from './helpers/add-form';
import { PrismaClient } from '@prisma/client';

/**
 * Hand-entered trades, through the form a person actually uses.
 *
 * The action behind this screen is covered against the database in
 * tests/integration/manual-trades.test.ts, and it was already correct when this file was
 * written. The bug that prompted it lived entirely in the form: the advanced section is kept
 * mounted while collapsed — deliberately, so a half-typed entry price survives a fold — which
 * means its open-date field submits whether or not anyone opened it. Defaulted to today, it
 * rejected every trade closed before today with "the open date is later than the close date",
 * naming a field the user could not see.
 *
 * That is the ordinary case for a journal: you write a trade down after you took it. So the
 * test that matters is the one that goes through the browser and backdates.
 */

const SYMBOL = 'E2EMAN';

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.trade.deleteMany({ where: { symbol: SYMBOL } });
  } finally {
    await prisma.$disconnect();
  }
});

/** `dd/mm/yyyy`, the one order every date field on this product reads. */
function displayDate(daysAgo: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - daysAgo);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
}

test('records a day trade that closed before today', async ({ page }) => {
  await page.goto('/long?book=day');

  await openAddForm(page, /add a trade/i);
  /*
   * The *visible* form. `/long` draws two that carry a symbol field — one for holdings and one
   * for hand-entered trades — and below `md` each is inside its own sheet, so the first match
   * in the document is whichever sheet happens to be shut.
   */
  const form = page
    .locator('form')
    .filter({ has: page.locator('input[name="symbol"]') })
    .filter({ visible: true })
    .first();
  await form.locator('input[name="symbol"]').fill(SYMBOL);
  // The close date only — the open date stays untouched, which is the whole point.
  await form.locator('input[placeholder="dd/mm/yyyy"]').first().fill(displayDate(5));
  await form.locator('input[name="profit"]').fill('250');
  await form.locator('input[name="risk"]').fill('100');
  await form.getByRole('button', { name: 'Add' }).click();

  await expect(form.getByText('The open date is later than the close date.')).toHaveCount(0);

  // It landed in the shared book, with the R multiple the typed risk implies.
  //
  // Found in whichever of the two the viewport is showing: the trades screen renders a table
  // from `md` up and a list of cards below it, each hiding the other, so a locator naming only
  // `tbody tr` resolves to thirteen rows on a phone and every one of them hidden. Both carry
  // the symbol and the multiple, which is the only part this test is about.
  await page.goto('/trades?range=max');
  const entry = page
    .locator('tbody tr, li')
    .filter({ hasText: SYMBOL })
    .filter({ visible: true })
    .first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('2.50R');
});

/**
 * Which rows the table says the trader typed.
 *
 * The badge exists to answer one question — "is this figure the broker's or mine?" — and on a
 * long-term holding it answered a different one. The Style column already read "Long"; the
 * badge beside it read "Holding", so the space kept for the one fact it was not saying said
 * the fact next to it again. Nobody but the trader enters a holding, so it is a manual entry
 * like any other and now says so.
 *
 * The badge is in the table, which exists from `md` up — below that the row is a card with no
 * room for it. So this is the desktop half of the screen, deliberately.
 */
test.describe('where a row came from', () => {
  test.skip(({ isMobile }) => !!isMobile, 'the badge lives in the table, which a phone replaces');

  test('says manual entry on a holding, not the word beside it', async ({ page }) => {
    await page.goto('/trades?range=max');

    /*
     * By where the row links, not by the word "Long".
     *
     * `hasText: 'Long'` was the obvious locator and it is the wrong one: most trades in the
     * book are long *positions*, so it matched an ordinary MT5 buy and the test passed against
     * the very layout it was written to reject. A holding is the only row that links to the
     * manual-entry book — its key is `position:…` and its href is `/long` — which is a
     * property of being a holding rather than a word that happens to appear in two columns.
     */
    const holding = page.locator('tbody tr:has(a[href="/long"])').first();
    await expect(holding, 'the seeded book has no holdings to read').toBeVisible();

    await expect(holding.locator('[data-source]')).toHaveAttribute('data-source', 'manual');
    await expect(holding).toContainText('Manual entry');
    await expect(holding, 'the badge still repeats the style column').not.toContainText('Holding');
  });

  test('gives every row one answer, and one that is on the badge', async ({ page }) => {
    // Not "most rows": a row with no badge is a row whose figures have no stated author, and
    // the badge is only worth having if it is on all of them.
    await page.goto('/trades?range=max');
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const badges = page.locator('tbody tr [data-source]');
    expect(await badges.count(), 'a row is missing its source badge').toBe(await rows.count());

    // And the badge says something, in the reader's language, rather than carrying the value
    // only in an attribute nobody can see.
    for (const text of await badges.allInnerTexts()) {
      expect(text.trim(), 'a source badge rendered empty').not.toBe('');
      expect(text, 'a holding is still labelled by its style').not.toContain('Holding');
    }
  });
});
