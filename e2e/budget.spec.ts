import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { closeAddForm, openAddForm } from './helpers/add-form';

/**
 * Budget ceilings on the finance screen, against the seeded demo tenant.
 *
 * The arithmetic is unit-tested; what cannot be seen from there is that the two halves of this
 * screen are joined at all. A budget is written by one form and spent against by another, and
 * they only meet if both land on the same category string, the same brother and the same
 * month. Any one of those three going astray leaves a dial that reads a confident zero
 * forever — a wrong answer that looks exactly like a right one, which is why it is worth the
 * cost of a browser.
 *
 * The walk is the one a person actually does: set a ceiling, spend against it, watch what is
 * left come down, then spend past it and read the overrun.
 */

const PREFIX = 'E2E';
/** Unique per run, so the two viewports this file runs under do not spend each other's money. */
const CATEGORY = `${PREFIX}-budget-${process.env.TEST_PARALLEL_INDEX ?? '0'}`;

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.financeEntry.deleteMany({ where: { label: { startsWith: PREFIX } } });
    await prisma.budget.deleteMany({ where: { category: { startsWith: PREFIX } } });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * The dial for one category, and the two figures under it.
 *
 * Pinned by holding both this category's dial and a remove control: the dial's own wrapper
 * carries the same classes as the one around it, so "innermost div containing the image" finds
 * the half of the tile without the spent figure on it.
 */
function gauge(page: Page, category: string) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('img', { name: category }) })
    .filter({ has: page.getByRole('button', { name: 'Remove budget' }) })
    .last();
}

/**
 * Set a ceiling, on whichever layout is drawing the form.
 *
 * Inline from `md`; on a phone it is behind a button whose handler only exists after
 * hydration, so a click that lands too early is swallowed silently. Clicking until the field
 * is actually visible is the only evidence the handler was attached.
 */
async function setCeiling(page: Page, category: string, amount: number) {
  const form = page.locator('form:has(input[list="budget-categories"])');
  const field = form.locator('input[name="category"]');
  const opener = page.getByRole('button', { name: 'Set a budget' }).first();

  for (let attempt = 0; attempt < 6 && !(await field.isVisible().catch(() => false)); attempt += 1) {
    if (await opener.isVisible().catch(() => false)) await opener.click();
    await expect(field)
      .toBeVisible({ timeout: 2_000 })
      .catch(() => undefined);
  }

  await field.fill(category);
  await form.locator('input[name="amount"]').fill(String(amount));
  await form.getByRole('button', { name: 'Set', exact: true }).click();
}

async function spend(page: Page, label: string, category: string, amount: number) {
  await openAddForm(page);
  await page.selectOption('select[name="type"]', 'expense');
  await page.fill('input[name="label"]', label);
  await page.fill('form:has(input[name="label"]) input[name="category"]', category);
  await page.fill('input[name="amountIls"]', String(amount));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await closeAddForm(page);
  await expect(page.getByText(label)).toBeVisible();
}

test.describe('a budget ceiling', () => {
  test('counts down as money is spent, then reports the overrun', async ({ page }) => {
    // The current month, explicitly: a budget is a monthly figure, and against an unbounded
    // window the card says so instead of drawing a dial.
    await page.goto('/finance');

    await setCeiling(page, CATEGORY, 2_000);
    await expect(gauge(page, CATEGORY)).toContainText('left of ₪2,000');
    await expect(gauge(page, CATEGORY)).toContainText('₪0 used');

    // The example this was built from: ₪2,000 set, ₪200 spent, ₪1,800 left.
    await spend(page, `${PREFIX} cigarettes`, CATEGORY, 200);
    await expect(gauge(page, CATEGORY)).toContainText('₪1,800');
    await expect(gauge(page, CATEGORY)).toContainText('₪200 used');

    // Past the ceiling the headline changes question: not what is left — there is none — but
    // by how much it was passed.
    await spend(page, `${PREFIX} more`, CATEGORY, 2_150);
    await expect(gauge(page, CATEGORY)).toContainText('+₪350');
    await expect(gauge(page, CATEGORY)).toContainText('over');
    await expect(gauge(page, CATEGORY)).not.toContainText('left of');

    // Removing the ceiling leaves the spending alone: the money was still spent.
    await gauge(page, CATEGORY).getByRole('button', { name: 'Remove budget' }).click();
    await expect(page.getByRole('img', { name: CATEGORY })).toHaveCount(0);
    await expect(page.getByText(`${PREFIX} cigarettes`)).toBeVisible();
  });

  test('says a monthly figure means nothing against an unbounded window', async ({ page }) => {
    await page.goto('/finance?range=max');
    await expect(page.getByText('a budget is a monthly figure')).toBeVisible();
  });
});
