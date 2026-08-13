import { expect, test, type Page } from '@playwright/test';

/**
 * A recorded session can be corrected.
 *
 * Until now the only way out of a mistyped hour was to delete the row and type the whole
 * session again — the note, the topic, the date, all of it — which is why people stop
 * correcting and the ledger quietly stops being true.
 *
 * The form is a URL (`?edit=<id>`), so it survives a reload, the back button leaves the form
 * rather than the screen, and the page stays a server component.
 */

const run = Date.now().toString(36).slice(-5);

/** Open the add sheet — or find the form already inline — surviving hydration. */
async function openForm(page: Page, field: ReturnType<Page['getByLabel']>) {
  const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await field.isVisible().catch(() => false)) return;
    if (await opener.isVisible().catch(() => false)) await opener.click();
    try {
      await expect(field).toBeVisible({ timeout: 2_000 });
      return;
    } catch {
      // swallowed by the pre-hydration DOM — go again
    }
  }
  throw new Error('the form never became visible');
}

/** Fill a form as one piece, because hydration can wipe a field after it was verified. */
async function fillForm(fields: { locator: ReturnType<Page['getByLabel']>; value: string }[]) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const field of fields) await field.locator.fill(field.value);
    try {
      for (const field of fields) {
        await expect(field.locator).toHaveValue(field.value, { timeout: 1_000 });
      }
      return;
    } catch {
      // hydration landed mid-pass; the next one sticks
    }
  }
  throw new Error('the form never held its values');
}

const what = (page: Page) => page.getByLabel(/^what|מה נלמד/i);
const hours = (page: Page) => page.getByLabel(/^hours|שעות/i).first();
const minutes = (page: Page) => page.getByLabel(/^minutes|דקות/i).first();

test.describe('correcting a study session', () => {
  test('opens the row in a seeded form and rewrites it in place', async ({ page }) => {
    const title = `מבנה שוק ${run}`;
    const fixed = `מבנה שוק מתוקן ${run}`;

    await page.goto('/learning?range=max');
    await openForm(page, what(page));
    await fillForm([
      { locator: what(page), value: title },
      { locator: hours(page), value: '2' },
      { locator: minutes(page), value: '0' },
    ]);
    await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
    const row = page.getByText(title, { exact: true }).first();
    await expect(row).toBeVisible();

    // Into the form, by the row's own edit control.
    await page
      .locator('li')
      .filter({ hasText: title })
      .getByRole('link', { name: /edit|עריכה/i })
      .click();
    await expect(page).toHaveURL(/edit=/);

    // Seeded with what was recorded, not blank — the whole point of editing over re-typing.
    await openForm(page, what(page));
    await expect(what(page)).toHaveValue(title);
    await expect(hours(page)).toHaveValue('2');

    await fillForm([
      { locator: what(page), value: fixed },
      { locator: hours(page), value: '1' },
      { locator: minutes(page), value: '30' },
    ]);
    await page.getByRole('button', { name: /^save$|^שמירה$/i }).click();

    // Rewritten, not duplicated — and back out of the form.
    await expect(page).not.toHaveURL(/edit=/);
    await expect(page.getByText(fixed, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await expect(page.getByText(fixed, { exact: true })).toHaveCount(1);
  });

  test('a stale edit link lands on the add form rather than an error', async ({ page }) => {
    // Someone else's id, or a row deleted in another tab. There is nothing the reader could
    // do about it, so the list is the honest answer.
    await page.goto('/learning?edit=clsomethingthatneverexisted');
    // On a phone the form sits behind its button either way; what matters is which form it is.
    await openForm(page, what(page));
    await expect(page.getByRole('button', { name: /^add$|^הוסף$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^save$|^שמירה$/i })).toHaveCount(0);
    await expect(what(page), 'a stale link seeded the form from somewhere').toHaveValue('');
  });
});
