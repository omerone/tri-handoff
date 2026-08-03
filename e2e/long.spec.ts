import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * Long-term positions (P3), against the seeded demo tenant.
 *
 * The lifecycle — enter, mark to market, close — is covered against the database in
 * tests/integration/long-positions.test.ts. What is only visible here is the currency split
 * the screen is built around: a position keeps its own currency in its own row, because that
 * is what the user compares against their broker, while the tiles above convert everything
 * into the currency they read in. The demo user reads shekels and the position below is in
 * dollars, so the two must not agree on a symbol.
 *
 * Positions created here are prefixed and removed in afterAll — the file runs once per
 * viewport against the same database.
 */

const PREFIX = 'E2E';

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.longPosition.deleteMany({ where: { symbol: { startsWith: PREFIX } } });
  } finally {
    await prisma.$disconnect();
  }
});

function tile(page: Page, label: string) {
  return page.locator(`div:has(> div:text-is("${label}"))`).first();
}

async function addPosition(page: Page, symbol: string) {
  await page.fill('input[name="symbol"]', symbol);
  // The symbol box is a search now. `E2E…` matches no listing, which is the manual path this
  // file is about — dismissing the menu keeps it from floating over the fields below.
  await page.keyboard.press('Escape');
  await page.fill('input[name="qty"]', '10');
  await page.fill('input[name="buyPrice"]', '100');
  await page.fill('input[name="fees"]', '0');
  await page.selectOption('select[name="currency"]', 'USD');
  await page.getByRole('button', { name: 'Add position' }).click();
  await expect(page.getByRole('cell', { name: symbol, exact: true })).toBeVisible();
}

test('the screen renders with its tiles and its form', async ({ page }) => {
  await page.goto('/long');

  for (const label of ['Cost', 'Value', 'Unrealized P&L', 'Realized P&L']) {
    await expect(tile(page, label)).toBeVisible();
  }
  await expect(page.getByText(/marked to the last close automatically/)).toBeVisible();

  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\b(long|nav)\.[a-zA-Z.]+/);
});

test('a dollar position is priced in dollars and totalled in shekels', async ({ page }) => {
  const symbol = `${PREFIX}${Date.now()}`;
  await page.goto('/long');
  await addPosition(page, symbol);

  const row = page.getByRole('row', { name: new RegExp(symbol) });

  // Per-position figures stay in the currency the position is denominated in — converting a
  // per-share price would be actively confusing next to a broker statement.
  await expect(row).toContainText('$100.00');
  await expect(row).toContainText('$1,000.00');

  // …while the roll-up above is in the currency the user reads in. Same portfolio, two
  // currencies, which is exactly the thing that would break if the page shared one rate.
  await expect(tile(page, 'Cost').locator('span[dir="ltr"]').first()).toContainText('₪');

  // A new position is marked at cost: showing a 100% loss on the day of purchase would be
  // the obvious alternative and it is nonsense.
  await expect(row).toContainText('+$0.00');
});

test('marking to market moves the value and the return', async ({ page }) => {
  const symbol = `${PREFIX}${Date.now()}`;
  await page.goto('/long');
  await addPosition(page, symbol);

  const row = page.getByRole('row', { name: new RegExp(symbol) });
  await row.getByRole('button', { name: 'Update price' }).click();
  await row.locator('input[name="currentPrice"]').fill('130');
  await row.getByRole('button', { name: 'Update price' }).click();

  await expect(row).toContainText('+$300.00');
  await expect(row).toContainText('30.0%');
  await expect(row).toContainText('$1,300.00');
});

test('finds a listing by company name and prices the position from it', async ({ page }) => {
  // The two halves of the feature in one pass: searching by name rather than ticker, and a
  // picked listing coming back as a position the refresh owns rather than the user.
  await page.goto('/long');
  await page.fill('input[name="symbol"]', 'Microsoft');

  // The listing whose *symbol* is MSFT, not the first row that merely mentions it. The
  // search returns up to a hundred listings now, and the world has tickers like "MSFT34" and
  // "4MSFT" — a substring match picked one of those and asserted its way to "4MSFT".
  const option = page
    .getByRole('option')
    .filter({ has: page.getByText('MSFT', { exact: true }) })
    .first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(page.locator('input[name="symbol"]')).toHaveValue('MSFT');
  // Picking a listing carries its currency across — Apple in London is quoted in pounds, and
  // a position saved in the wrong one is never marked to market at all.
  await expect(page.locator('select[name="currency"]')).toHaveValue('USD');

  await page.fill('input[name="qty"]', '3');
  await page.fill('input[name="buyPrice"]', '100');
  await page.getByRole('button', { name: 'Add position' }).click();

  const row = page.getByRole('row', { name: /MSFT/ }).first();
  await expect(row).toContainText('auto');

  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
});

test('closing a position banks the gain and moves it out of the open book', async ({ page }) => {
  const symbol = `${PREFIX}${Date.now()}`;
  await page.goto('/long');
  await addPosition(page, symbol);

  const row = page.getByRole('row', { name: new RegExp(symbol) });
  await row.getByRole('button', { name: 'Close', exact: true }).click();
  await row.locator('input[name="sellPrice"]').fill('150');
  await row.getByRole('button', { name: 'Close position' }).click();

  // 10 × 150 − 10 × 100. Realized, not unrealized: it is money that has landed.
  await expect(row).toContainText('+$500.00');
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  // A closed position cannot be re-priced or re-closed.
  await expect(row.getByRole('button', { name: 'Update price' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { name: symbol, exact: true })).toHaveCount(0);
});

test('keeps the search icon out of the ticker', async ({ page }) => {
  // The icon is positioned physically and the input reserves physical padding. A logical pair
  // drifts apart in Hebrew — the input is `dir="ltr"` so its logical end is the right, while
  // the icon's wrapper inherits RTL and puts its logical end on the left — which is how the
  // magnifier came to sit on top of the "T" in "TSLA". Hebrew is the default locale, so this
  // is the layout most users see, and nothing else in the suite would notice.
  await page.goto('/long');
  await page.context().addCookies([{ name: 'tri_locale', value: 'he', url: page.url() }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const input = page.locator('input[name="symbol"]');
  await input.fill('TSLA');

  const field = (await input.boundingBox())!;
  const icon = (await page.locator('input[name="symbol"] + span').boundingBox())!;
  const reserved = await input.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));

  // The icon has to live entirely inside the padding the input set aside for it. Anywhere
  // else and it is drawn over whatever the user typed.
  expect(icon.x, 'the icon is outside the space reserved for it').toBeGreaterThanOrEqual(
    field.x + field.width - reserved - 1,
  );
  expect(icon.x + icon.width, 'the icon overflows the field').toBeLessThanOrEqual(
    field.x + field.width + 1,
  );
});
