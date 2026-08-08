import { expect, test, type Page } from '@playwright/test';

/**
 * Filling the second account slot must not offer to delete the first account's book.
 *
 * This is a data-loss bug, and it was reachable by doing the ordinary thing: the settings page
 * draws two slots, the second one is empty, and connecting into it is how a trader adds their
 * other account.
 *
 * The cause was that the card and the connect action answered "which account is in this slot?"
 * separately, and disagreed about the one case that has no obvious answer — an account with no
 * purpose, which is every account connected before that column existed. The card gives such an
 * account the first *unclaimed* slot, so it is drawn under "Swing account" and the day slot is
 * drawn empty. The action asked for an account whose purpose was `day`, found none, and fell
 * back to any account with no purpose — which found the very account sitting in the other slot.
 * So submitting the empty day slot was read as replacing the swing one, and the trader was
 * shown "This will delete the trade book — 92 trades will be deleted" with a button that did
 * exactly that. Re-syncing does not bring the journal columns back: `TradeUpsert` excludes
 * note, tags, rating, mood, strategy and both review answers on purpose.
 *
 * The seeded account this suite signs in with has no purpose, which is what makes this
 * reachable here — and is the same shape as a real account connected before the migration.
 *
 * Both slots are put back the way they were found, because every spec after this one reads the
 * same seeded book.
 */

const SWING = '#50214437';
const DAY = '60111111';

function slotFor(page: Page, heading: string) {
  return page.locator('section').filter({ hasText: heading }).first();
}

test.describe('filling the second account slot', () => {
  test('adds an account instead of offering to delete the first one', async ({ page }) => {
    await page.goto('/settings');

    // The seeded account, drawn in the swing slot because nothing claims it.
    await expect(page.getByText(SWING).first()).toBeVisible();
    const tradesBefore = await countTrades(page);
    expect(tradesBefore).toBeGreaterThan(0);

    // --- connect into the empty day slot, the ordinary way ---------------------------------
    await page.goto('/settings');
    const day = slotFor(page, 'Day-trading account');
    const next = day.getByRole('button', { name: 'Next' });
    await next.click();
    await day.locator('#login-field').fill(DAY);
    await next.click();
    await day.locator('#server').fill('MetaQuotes-Live01');
    await next.click();
    await day.locator('#password-field').fill('investor-read-only');
    await day.getByRole('button', { name: 'Connect account' }).click();

    /*
     * The assertion the bug was hiding behind. Before the fix this warning appeared here, with
     * a count of the swing account's trades, and the only way past it deleted them.
     */
    await expect(page.getByText('This will delete the trade book')).toHaveCount(0);
    await expect(page.getByText(`#${DAY}`).first()).toBeVisible({ timeout: 60_000 });

    // --- two accounts, and the first one's book intact ------------------------------------
    await expect(page.getByText(SWING).first()).toBeVisible();
    expect(await countTrades(page)).toBeGreaterThanOrEqual(tradesBefore);

    // --- put the day slot back, taking its imported rows with it --------------------------
    // Disconnect opens an either/or — keep the trades or delete them — and the second press
    // is the one inside it. Deleting is what restores the book the rest of the suite reads.
    await page.goto('/settings');
    const slot = slotFor(page, 'Day-trading account');
    await slot.getByRole('button', { name: 'Disconnect' }).first().click();
    await slot.getByText(/together with the account/).click();
    await slot.getByRole('button', { name: 'Disconnect' }).last().click();
    await expect(page.getByText(`#${DAY}`)).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText(SWING).first()).toBeVisible();
    expect(await countTrades(page)).toBe(tradesBefore);
  });
});

/** How many rows the journal holds, read from the trades screen's own count. */
async function countTrades(page: Page): Promise<number> {
  await page.goto('/trades');
  const text = await page.locator('main').innerText();
  const match = text.match(/(\d[\d,]*)\s+trades?/i);
  return match ? Number(match[1]!.replace(/,/g, '')) : 0;
}
