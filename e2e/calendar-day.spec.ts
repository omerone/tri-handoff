import { expect, test, type Page } from '@playwright/test';

/**
 * Opening a day out of the calendar.
 *
 * A square could say three things — the net, the count and the win rate — and the hover card
 * behind it said the same three in longer words. Neither answered the question a trader asks of
 * a green day: *which* trades. Answering it meant leaving the calendar for the table and
 * narrowing it back down to the day already being pointed at.
 *
 * A dialog rather than a filtered table, because a calendar is scanned: open a day, read it,
 * close it, carry on down the month. It is one component at both sizes — a sheet from the
 * bottom edge on a phone, a card in the middle from `sm` — so both projects run the same
 * assertions.
 */

const days = (page: Page) => page.locator('main button[aria-controls][aria-haspopup="dialog"]');

test.describe('a day in the calendar', () => {
  test('opens on the trades behind it', async ({ page }) => {
    await page.goto('/calendar?m=2026-07');

    const traded = days(page);
    expect(await traded.count(), 'no day is openable').toBeGreaterThan(0);
    await expect(page.locator('[role="dialog"]'), 'a day was open on arrival').toHaveCount(0);

    await traded.first().click();
    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    await expect(dialog).toBeVisible();

    // The rows are the point: one per trade, each carrying what the square could not.
    const rows = dialog.locator('li');
    const count = await rows.count();
    expect(count, 'the day opened with no trades in it').toBeGreaterThan(0);

    const first = rows.first();
    await expect(first).toContainText(/[₪$€£]/); // its own P&L
    await expect(first).toContainText(/\d{2}:\d{2}/); // the time it closed
    await expect(first.locator('a')).toHaveAttribute('href', /\/trades\/[0-9a-z]+/i);

    // And the header agrees with the square that opened it.
    await expect(dialog).toContainText(new RegExp(`${count}`));

    /*
     * The square's own hover card is put away while the day is open. Pressing a square leaves
     * the pointer on it, and the card opens on hover — so it sat behind the dimmer repeating
     * the date, the net and the win rate the dialog had just opened by showing.
     */
    await expect(page.locator('main [role="tooltip"]').filter({ visible: true })).toHaveCount(0);
  });

  test('closes on Escape, and a day with nothing on it does not open at all', async ({ page }) => {
    await page.goto('/calendar?m=2026-07');
    await days(page).first().click();
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);

    /*
     * An empty square is not a button. A month is mostly empty days, and making every one of
     * them focusable would put twenty tab stops between the reader and the next control for a
     * dialog that would open on nothing.
     */
    const squares = await page.locator('main .grid > div, main .grid > button').count();
    expect(await days(page).count(), 'every square is a button').toBeLessThan(squares);
  });

  test('takes the reader to the trade it names', async ({ page }) => {
    await page.goto('/calendar?m=2026-07');
    await days(page).first().click();

    const dialog = page.locator('[role="dialog"][aria-modal="true"]');
    const symbol = (await dialog.locator('li').first().innerText()).match(
      /[A-Z]{3,}[A-Z0-9/]*/,
    )?.[0];
    await dialog.locator('li a').first().click();

    await expect(page).toHaveURL(/\/trades\/[0-9a-z]+$/i);
    if (symbol) await expect(page.locator('main')).toContainText(symbol);
  });
});
