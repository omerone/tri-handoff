import { expect, test } from '@playwright/test';
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

  const form = page.locator('form').filter({ has: page.locator('input[name="symbol"]') }).first();
  await form.locator('input[name="symbol"]').fill(SYMBOL);
  // The close date only — the open date stays untouched, which is the whole point.
  await form.locator('input[placeholder="dd/mm/yyyy"]').first().fill(displayDate(5));
  await form.locator('input[name="profit"]').fill('250');
  await form.locator('input[name="risk"]').fill('100');
  await form.getByRole('button', { name: 'Add' }).click();

  await expect(form.getByText('The open date is later than the close date.')).toHaveCount(0);

  // It landed in the shared book, with the R multiple the typed risk implies.
  await page.goto('/trades?range=max');
  const row = page.locator('tbody tr').filter({ hasText: SYMBOL }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('2.50R');
});
