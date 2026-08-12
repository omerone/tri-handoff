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

/**
 * A category nothing else on the demo book will touch.
 *
 * Per test as well as per worker: the ledger is only cleaned up once the file is done, so two
 * tests sharing a category would have the first one's spending still sitting under the
 * second one's ceiling — and the second would read a confident, wrong number.
 */
const category = (test: string) =>
  `${PREFIX}-${test}-${process.env.TEST_PARALLEL_INDEX ?? '0'}`;

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.financeEntry.deleteMany({ where: { label: { startsWith: PREFIX } } });
    await prisma.budget.deleteMany({ where: { category: { startsWith: PREFIX } } });
    // A built-in, used below to prove a ceiling written by a category's *name* finds it.
    await prisma.budget.deleteMany({ where: { category: 'food' } });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * One category's tile: the dial, the figures under it, and its controls.
 *
 * Walked up from the dial rather than filtered by what is inside it. The obvious locator —
 * the innermost div holding both this dial and a remove button — stops resolving the moment
 * the tile is put into edit mode, because the remove button is what the editor replaces.
 */
function tile(page: Page, category: string) {
  return page.getByRole('img', { name: category }).locator('xpath=ancestor::div[2]');
}

/**
 * Set a ceiling, on whichever layout is drawing the form.
 *
 * Inline from `md`; on a phone it is behind a button whose handler only exists after
 * hydration, so a click that lands too early is swallowed silently. Clicking until the field
 * is actually visible is the only evidence the handler was attached.
 */
async function setCeiling(page: Page, category: string, amount: number, currency = 'ILS') {
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
  // Stated rather than left to the default, which follows whatever the header is reading in.
  await form.locator('select[name="currency"]').selectOption(currency);
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
    const CATEGORY = category('spend');
    // The current month, explicitly: a budget is a monthly figure, and against an unbounded
    // window the card says so instead of drawing a dial.
    await page.goto('/finance');

    await setCeiling(page, CATEGORY, 2_000);
    await expect(tile(page, CATEGORY)).toContainText('left of ₪2,000');
    await expect(tile(page, CATEGORY)).toContainText('₪0 used');

    // The example this was built from: ₪2,000 set, ₪200 spent, ₪1,800 left.
    await spend(page, `${PREFIX} cigarettes`, CATEGORY, 200);
    await expect(tile(page, CATEGORY)).toContainText('₪1,800');
    await expect(tile(page, CATEGORY)).toContainText('₪200 used');

    // Past the ceiling the headline changes question: not what is left — there is none — but
    // by how much it was passed.
    await spend(page, `${PREFIX} more`, CATEGORY, 2_150);
    await expect(tile(page, CATEGORY)).toContainText('+₪350');
    await expect(tile(page, CATEGORY)).toContainText('over');
    await expect(tile(page, CATEGORY)).not.toContainText('left of');

    // Removing the ceiling leaves the spending alone: the money was still spent.
    await tile(page, CATEGORY)
      .getByRole('button', { name: `Remove the budget on ${CATEGORY}` })
      .click();
    await expect(page.getByRole('img', { name: CATEGORY })).toHaveCount(0);
    await expect(page.getByText(`${PREFIX} cigarettes`)).toBeVisible();
  });

  test('changes a ceiling in place, leaving one budget rather than two', async ({ page }) => {
    const CATEGORY = category('edit');
    // Editing through the form at the bottom would mean retyping the category, and a typo
    // there writes a *second* ceiling beside the first with the spending divided between
    // them — two dials, both wrong, and nothing on screen saying why.
    await page.goto('/finance');

    await setCeiling(page, CATEGORY, 2_000);
    await spend(page, `${PREFIX} coffee`, CATEGORY, 500);
    await expect(tile(page, CATEGORY)).toContainText('₪1,500');

    await tile(page, CATEGORY)
      .getByRole('button', { name: `Change the ceiling on ${CATEGORY}` })
      .click();

    // Prefilled with what is already set, so a change is a change and not a re-entry.
    const field = tile(page, CATEGORY).getByRole('textbox', { name: 'Monthly ceiling' });
    await expect(field).toHaveValue('2000');
    await field.fill('800');
    await tile(page, CATEGORY).getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('img', { name: CATEGORY })).toHaveCount(1);
    await expect(tile(page, CATEGORY)).toContainText('left of ₪800');
    await expect(tile(page, CATEGORY)).toContainText('₪300');
    await expect(tile(page, CATEGORY)).toContainText('₪500 used');
  });

  test('is kept in the currency it was written in, whatever the screen is reading', async ({
    page,
  }) => {
    /*
     * The bug this closes: 2,000 entered as shekels on a screen set to dollars came back as
     * $667. The figure was right and the unit was never asked for, so the ceiling a person
     * typed and the ceiling they were shown were different numbers.
     *
     * Now the currency travels with the budget. Everything else on this screen stays in
     * shekels while this one tile is in dollars, which is what proves the header is not the
     * thing deciding it.
     */
    const CATEGORY = category('usd');
    await page.goto('/finance');

    await setCeiling(page, CATEGORY, 500, 'USD');
    await expect(tile(page, CATEGORY)).toContainText('left of $500');

    // Spent in shekels, as the ledger always is, and converted up to meet the ceiling.
    await spend(page, `${PREFIX} groceries`, CATEGORY, 900);
    await expect(tile(page, CATEGORY)).not.toContainText('₪');
    // Around three shekels to the dollar, and the rate moves: assert the shape, not the cents.
    await expect(tile(page, CATEGORY)).toContainText(/\$(29\d|30\d) used/);
  });

  test('is offered on the form that files money into it', async ({ page }) => {
    /*
     * The reported bug. A category the trader invented, given a ceiling, and then missing
     * from the list on the expense form — so the only way to spend against it was to retype
     * it by hand, which is where the two sides drift apart. One trailing space and the dial
     * never sees the money.
     */
    const CATEGORY = category('offered');
    await page.goto('/finance');
    await setCeiling(page, CATEGORY, 1_000);

    await expect(
      page.locator(`#tri-finance-categories option[value="${CATEGORY}"]`),
      'the budgeted category is missing from the expense form',
    ).toHaveCount(1);
  });

  test('finds the money when the ceiling was written by the category’s name', async ({ page }) => {
    /*
     * Built-in categories are stored as keys and offered by their translated name, so a
     * ceiling set by picking "Food & dining" hands back that phrase while the expenses under
     * it are filed as `food`. Left unresolved the two never meet, and the dial reads a
     * confident zero — the failure on this screen that looks exactly like a right answer.
     *
     * Deliberately a category whose name is not its key with a capital letter on it: the
     * folding that makes "Food" and "food" one category would otherwise cover this up, and
     * in Hebrew — where the name is "מזון ומסעדות" — there would be nothing to cover it.
     */
    const NAME = 'Food & dining';
    await page.goto('/finance');
    await setCeiling(page, NAME, 3_000);
    await spend(page, `${PREFIX} restaurant`, NAME, 500);

    await expect(tile(page, NAME)).not.toContainText('₪0 used');
    await expect(tile(page, NAME)).toContainText('left of ₪3,000');
  });

  test('says a monthly figure means nothing against an unbounded window', async ({ page }) => {
    await page.goto('/finance?range=max');
    await expect(page.getByText('a budget is a monthly figure')).toBeVisible();
  });
});
