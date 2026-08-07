import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * The personal-finance screen (P2), against the seeded demo tenant.
 *
 * Two things here cannot be seen from a unit test. The first is the currency handling: the
 * page holds *two* rates — finance is ILS-native, the trading account is in the broker's
 * currency — and picking the wrong one produces a number that looks entirely reasonable. The
 * demo user reads in shekels and the demo account is in dollars, so a shekel figure converted
 * at the trading rate would be roughly three and a half times too big and nothing would
 * complain. Asserting an exact shekel delta is what pins that down.
 *
 * The second is that recurring entries are expanded on read: a row written once has to appear
 * in a month it was never written to, which only shows up when a real month boundary is
 * crossed in the real page.
 *
 * Everything created here is labelled with the prefix and removed in afterAll, so the demo
 * book is the same afterwards as before — including for the second viewport, which runs the
 * whole file again.
 */

const PREFIX = 'E2E';

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.financeEntry.deleteMany({ where: { label: { startsWith: PREFIX } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** A KPI tile, found by its label rather than by a class that exists to be restyled. */
function tile(page: Page, label: string) {
  return page.locator(`div:has(> div:text-is("${label}"))`).first();
}

/** The figure on a tile, as a number — "₪12,345" → 12345. */
async function figure(page: Page, label: string): Promise<number> {
  const text = await tile(page, label).locator('span[dir="ltr"]').first().innerText();
  return Number(text.replace(/[^\d.-]/g, ''));
}

/** The innermost element holding both an entry's label and its own delete control. */
function row(page: Page, label: string) {
  return page
    .locator('div', { hasText: label })
    .filter({ has: page.getByRole('button', { name: 'Delete' }) })
    .last();
}

async function addEntry(
  page: Page,
  entry: { type: 'income' | 'expense'; label: string; amount: number; recurring?: boolean },
) {
  await page.selectOption('select[name="type"]', entry.type);
  await page.fill('input[name="label"]', entry.label);
  await page.fill('input[name="amountIls"]', String(entry.amount));
  if (entry.recurring) await page.check('input[name="isRecurring"]');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(entry.label)).toBeVisible();
}

test.describe('the finance screen', () => {
  test('shows the month, the four tiles and the entry form', async ({ page }) => {
    await page.goto('/finance');

    // "All-time net", not "Monthly net": the default view is unbounded and spans every entry
    // ever recorded, so the third tile is only labelled by a period when a range is set.
    for (const label of ['Income', 'Expenses', 'All-time net', 'Total wealth']) {
      await expect(tile(page, label)).toBeVisible();
    }
    await expect(page.getByText('Personal finance')).toBeVisible();
    await expect(page.locator('input[name="amountIls"]')).toBeVisible();

    // next-intl renders the key itself when a message is missing.
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\b(finance|nav|categories)\.[a-zA-Z.]+/);
  });

  test('breaks total wealth down into the three sources it adds up', async ({ page }) => {
    // They start in three different currencies and are converted separately on purpose; the
    // sub-line is where a user can see that the total is not one opaque figure.
    await page.goto('/finance');
    const wealth = tile(page, 'Total wealth');

    await expect(wealth).toContainText('Trading account');
    await expect(wealth).toContainText('Recorded cash flow');
  });
});

test.describe('shekel figures are not converted at the trading rate', () => {
  test('an entry of ₪1,000 moves the income tile by exactly 1,000', async ({ page }) => {
    // The demo user reads in ILS and the demo MT5 account is in USD. Finance is ILS-native,
    // so with an ILS display currency the conversion is the identity — an income figure that
    // moved by ~3,700 would mean the page had reached for the account's rate instead.
    await page.goto('/finance');
    const beforeIncome = await figure(page, 'Income');
    const beforeWealth = await figure(page, 'Total wealth');

    const label = `${PREFIX} salary ${Date.now()}`;
    await addEntry(page, { type: 'income', label, amount: 1_000 });

    expect(await figure(page, 'Income')).toBe(beforeIncome + 1_000);

    // Total wealth adds the converted cash to the converted trading balance. Cash is the only
    // component that moved, and it must move by its own, unconverted amount. One shekel of
    // slack for the rounding of the trading component, nothing like the thousands a
    // misapplied rate would cost.
    expect(
      Math.abs((await figure(page, 'Total wealth')) - beforeWealth - 1_000),
    ).toBeLessThanOrEqual(1);
  });

  test('deleting the entry puts the tile back where it was', async ({ page }) => {
    await page.goto('/finance');
    const before = await figure(page, 'Income');

    const label = `${PREFIX} refund ${Date.now()}`;
    await addEntry(page, { type: 'income', label, amount: 250 });
    expect(await figure(page, 'Income')).toBe(before + 250);

    page.once('dialog', (dialog) => dialog.accept());
    await row(page, label).getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(label)).toHaveCount(0);
    expect(await figure(page, 'Income')).toBe(before);
  });
});

/**
 * The month after the one showing, as a range token.
 *
 * The screen used to carry its own month arrows and now reads the shared time range, so a
 * test that needs a different month asks for it the way the product does — through `?range`.
 * The picker's own behaviour is covered exhaustively in range.spec.ts; what these two tests
 * are about is a recurring row appearing in a month nobody wrote it into.
 */
function monthRange(offset: number): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  const token = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;
  return `/finance?range=${token}..${token}`;
}

test.describe('recurring entries', () => {
  test('appear in a month they were never written to', async ({ page }) => {
    // The row exists once. Next month has to be computed from it, and the tile has to count
    // it — the whole design rests on that, and nothing else in the suite crosses a month
    // boundary on this screen.
    await page.goto(monthRange(1));
    const nextMonthExpensesBefore = await figure(page, 'Expenses');

    await page.goto(monthRange(0));
    const label = `${PREFIX} rent ${Date.now()}`;
    await addEntry(page, { type: 'expense', label, amount: 777, recurring: true });
    await expect(page.getByText('Recurring').first()).toBeVisible();

    await page.goto(monthRange(1));
    await expect(page.getByText(label)).toBeVisible();
    expect(await figure(page, 'Expenses')).toBe(nextMonthExpensesBefore + 777);
  });

  test('offer both ending the series and deleting it, which mean different things', async ({
    page,
  }) => {
    /*
     * *End series* stops the entry from here on and leaves every month it has already
     * appeared in alone — the right action when a job ends, because last year's balance
     * should not change retroactively.
     *
     * *Delete* removes it from every month. That is wrong for a salary that ended and
     * exactly right for one entered by mistake. An earlier version offered only the first,
     * which left a mistyped recurring entry uncorrectable forever.
     */
    await page.goto(monthRange(0));
    const label = `${PREFIX} gym ${Date.now()}`;
    await addEntry(page, { type: 'expense', label, amount: 120, recurring: true });

    await page.goto(monthRange(1));
    const generated = page
      .locator('div', { hasText: label })
      .filter({ has: page.getByRole('button', { name: 'End series' }) })
      .last();

    await expect(generated.getByRole('button', { name: 'End series' })).toBeVisible();
    await expect(generated.getByRole('button', { name: 'Delete' })).toBeVisible();
  });
});
