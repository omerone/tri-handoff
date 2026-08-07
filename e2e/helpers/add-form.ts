import type { Page } from '@playwright/test';

/**
 * Bring an entry form into reach, on whichever layout is drawing it.
 *
 * From `md` the forms are on the page and this does nothing. Below that they are behind a
 * button — a stack of eight fields is most of a phone screen, and it sat above the thing the
 * screen is actually for — so the sheet has to be opened before anything can be typed into it.
 *
 * Every spec that fills one of these forms needs this, and the alternative is each of them
 * knowing which layout it is running under. They should not: what they are about is what
 * happens after the form is submitted.
 *
 * Safe to call unconditionally. If there is no button, there is nothing to open.
 *
 * `which` matters on the long-term book, which has two of these on one page — a form for
 * holdings and a form for hand-entered trades. The first version took whichever came first and
 * opened the trade sheet for a test that was about to type a position into it.
 */
export async function openAddForm(
  page: Page,
  which: RegExp = /add (an entry|a trade|a position)/i,
): Promise<void> {
  const button = page.getByRole('button', { name: which }).filter({ visible: true }).first();
  if ((await button.count()) > 0) await button.click();
}

/**
 * Put the sheet away again.
 *
 * It stays open after a submit on purpose — the form reports "added" inside it, and entering a
 * month of expenses is several in a row — but while it is up it covers the list underneath, so
 * anything that wants to *read* what was just added has to close it first.
 *
 * Does nothing when there is no sheet, which is every wide-screen run.
 */
export async function closeAddForm(page: Page): Promise<void> {
  const sheet = page.locator('[role="dialog"][aria-modal="true"]');
  if ((await sheet.count()) === 0) return;
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
}
