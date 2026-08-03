import { expect, test, type Page } from '@playwright/test';

/**
 * The time range, against the seeded demo book (92 trades, ending in July 2026).
 *
 * The unit tests own the arithmetic — what the range resolves to, which days are inside it,
 * where the equity curve starts. What only a browser can show is whether the one control
 * actually reaches every screen, whether it survives a nav link that carries no query string,
 * and whether it composes with the filters a screen already had.
 */

test.describe('the picker', () => {
  test('is on every screen that reads a period, and on no others', async ({ page }) => {
    for (const path of ['/dashboard', '/analytics', '/trades', '/calendar', '/finance']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Maximum', exact: true })).toBeVisible();
    }

    // Open positions are what is held right now, and Settings is not data at all.
    for (const path of ['/long', '/settings']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Maximum', exact: true })).toHaveCount(0);
    }
  });

  test('puts the chosen range in the URL, so it can be shared', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Last month', exact: true }).click();
    await expect(page).toHaveURL(/range=last-month/);
    await expect(page.getByRole('button', { name: 'Last month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('follows a nav link that carries no query string of its own', async ({ page }) => {
    // The whole reason the range is mirrored into a cookie: `<Link href="/trades">` has no
    // idea a range exists, and threading one through every link in the product would mean
    // every future link remembering to.
    await page.goto('/analytics');
    await page.getByRole('button', { name: 'Last month', exact: true }).click();

    await page.getByRole('link', { name: 'Trades', exact: true }).click();
    await expect(page).toHaveURL(/\/trades$/);
    await expect(page.getByRole('button', { name: 'Last month', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('honours a shared link over the reader’s own cookie', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Last month', exact: true }).click();

    // Arriving with an explicit range: what the link says wins, or the recipient is quietly
    // shown a different month than the person who sent it.
    await page.goto('/dashboard?range=max');
    await expect(page.getByRole('button', { name: 'Maximum', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('what the range does to a screen', () => {
  test('narrows the trades table and its summary', async ({ page }) => {
    await page.goto('/trades');
    const all = Number((await page.locator('main').innerText()).match(/(\d+) trades/)![1]);

    await page.getByRole('button', { name: 'Last month', exact: true }).click();
    // The preset is a form submit, so the figure has to be read after the redirect lands
    // rather than off the page that is still on screen while it is in flight.
    await expect(page).toHaveURL(/range=last-month/);
    const lastMonth = Number((await page.locator('main').innerText()).match(/(\d+) trades/)![1]);

    expect(lastMonth).toBeGreaterThan(0);
    expect(lastMonth).toBeLessThan(all);
  });

  test('composes with the filters a screen already has', async ({ page }) => {
    // Changing the range on a table narrowed to crypto must not throw the narrowing away —
    // and the page number, which names a position inside the *old* window, must not survive.
    await page.goto('/trades?class=crypto&page=2');
    await page.getByRole('button', { name: 'Last month', exact: true }).click();

    await expect(page).toHaveURL(/class=crypto/);
    await expect(page).toHaveURL(/range=last-month/);
    await expect(page).not.toHaveURL(/page=2/);
  });

  test('says the window is empty rather than offering to connect a broker', async ({ page }) => {
    // August 2026 is past the end of the seeded book. The all-time empty state invites the
    // user to connect an account they already have, which reads as the sync having failed.
    await page.goto('/dashboard?range=this-month');
    await expect(page.getByText('No data in the selected range')).toBeVisible();
    await expect(page.getByText(/Connect your MT5 account/)).toHaveCount(0);
  });

  test('turns the calendar into the months it covers', async ({ page }) => {
    await page.goto('/calendar?range=2026-05..2026-07');

    // Newest first, and every month in the range. Scoped to `main`: the picker's own summary
    // names the same months in the header, which is the point of it.
    for (const month of ['July 2026', 'June 2026', 'May 2026']) {
      await expect(page.locator('main').getByText(new RegExp(month))).toBeVisible();
    }

    // Stepping out of the range would show a month the picker says is not selected.
    await expect(page.getByRole('link', { name: 'Previous month' })).toHaveCount(0);
  });

  test('leaves the calendar browsable when nothing is pinned down', async ({ page }) => {
    await page.goto('/calendar?range=max');
    await expect(page.getByText(/July 2026/)).toBeVisible();
    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.getByText(/June 2026/)).toBeVisible();
  });

  test('reports finance over the window rather than a month', async ({ page }) => {
    await page.goto('/finance?range=2026-05..2026-07');

    await expect(page.getByText('Range net')).toBeVisible();
    // The card is titled by the range it is showing.
    await expect(page.locator('main').getByText(/May 2026 – July 2026/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Previous month' })).toHaveCount(0);
  });
});

test.describe('the custom panel', () => {
  const open = (page: Page) =>
    page.getByRole('button', { name: 'Custom range' }).click();

  test('applies a month range', async ({ page }) => {
    await page.goto('/dashboard');
    await open(page);

    const from = page.locator('select[name="fromMonthMonth"]');
    await expect(from).toBeVisible();
    await from.selectOption('5');
    await page.locator('select[name="fromMonthYear"]').selectOption('2026');
    await page.locator('select[name="toMonthMonth"]').selectOption('7');
    await page.locator('select[name="toMonthYear"]').selectOption('2026');

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/range=2026-05\.\.2026-07/);
  });

  test('applies a date range typed in the product’s order', async ({ page }) => {
    // dd/mm/yyyy, everywhere — `<input type="date">` renders in the browser's locale, which
    // is how the 2nd of August becomes 08/02 for half the people who open it.
    await page.goto('/dashboard');
    await open(page);
    await page.getByRole('button', { name: 'Dates', exact: true }).click();

    const fields = page.getByPlaceholder('dd/mm/yyyy');
    await fields.first().fill('01/06/2026');
    await fields.nth(1).fill('15/06/2026');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/range=2026-06-01\.\.2026-06-15/);
  });

  test('shows one mode at a time, and only its two fields', async ({ page }) => {
    await page.goto('/dashboard');
    await open(page);

    // Months is the default, and the date fields are not merely hidden — they are absent, so
    // their `required` cannot block a submission for a field nobody can see or focus.
    await expect(page.locator('select[name="fromMonthMonth"]')).toBeVisible();
    await expect(page.locator('input[name="fromDate"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Dates', exact: true }).click();
    await expect(page.locator('select[name="fromMonthMonth"]')).toHaveCount(0);
    await expect(page.locator('input[name="fromDate"]')).toHaveCount(1);
  });

  test('opens showing the bounds it is responsible for', async ({ page }) => {
    await page.goto('/analytics?range=2026-05..2026-07');
    // Already open, and stating what is in force rather than making the user go and look.
    await expect(page.locator('select[name="fromMonthYear"]')).toBeVisible();
    await expect(page.locator('select[name="toMonthMonth"]')).toHaveValue('7');
  });

  test('opens on the dates form when a date range is what is showing', async ({ page }) => {
    await page.goto('/analytics?range=2026-06-01..2026-06-15');
    await expect(page.locator('input[name="fromDate"]')).toHaveCount(1);
    await expect(page.getByPlaceholder('dd/mm/yyyy').first()).toHaveValue('01/06/2026');
  });

  test('floats over the page instead of pushing it down', async ({ page }) => {
    // The bar lives in the sticky header. A panel that expands it moves every screen down by a
    // row and takes the row back on the next click — the page shifting under the reader as a
    // side effect of opening a menu.
    await page.goto('/dashboard');
    const before = (await page.locator('main').boundingBox())!;

    await open(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    const after = (await page.locator('main').boundingBox())!;
    expect(after.y).toBe(before.y);
  });

  test('dismisses on Escape and hands focus back to its button', async ({ page }) => {
    await page.goto('/dashboard');
    await open(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Otherwise the way out of the popover is hunting for the button again.
    await expect(page.getByRole('button', { name: 'Custom range' })).toBeFocused();
  });

  test('dismisses on a click elsewhere', async ({ page }) => {
    await page.goto('/dashboard');
    await open(page);

    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('closes when a preset answers the question instead', async ({ page }) => {
    // The panel used to stay open across the navigation, leaving a form full of month fields
    // standing under a picker that says the range is everything.
    await page.goto('/dashboard?range=2026-05..2026-07');
    await expect(page.locator('select[name="fromMonthMonth"]')).toBeVisible();

    await page.getByRole('button', { name: 'Maximum', exact: true }).click();
    await expect(page).toHaveURL(/range=max/);
    await expect(page.locator('select[name="fromMonthMonth"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Custom range' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
