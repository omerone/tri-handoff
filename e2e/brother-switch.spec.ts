import { expect, test, type Page } from '@playwright/test';

/**
 * The brother switch: one login, two people, and a header control that always rests on one
 * of them — there is no merged position, because the brothers asked for their money apart
 * and a combined view of two private budgets is the thing they were separating.
 *
 * Whose row a new entry becomes is *stated* by the form, not asked: the switch already
 * answered, and a second control that could disagree was a contradiction waiting to be
 * clicked — a session entered on אביתר's screen, attributed to יוני, gone the moment it saved.
 *
 * Titles are unique per run because the ledgers accumulate across runs; the names cannot be,
 * so no assertion here does totals arithmetic.
 */

const run = Date.now().toString(36).slice(-5);

const flip = (page: Page, name: string) =>
  page
    .getByRole('group', { name: /whose data|של מי הנתונים/i })
    .getByRole('button', { name, exact: true });

/**
 * Fill a whole form so it survives hydration, then verify it as one piece.
 *
 * Flipping the switch navigates, and the next screen hydrates while the test is already
 * typing. React re-rendering an uncontrolled input wipes whatever was typed into the
 * pre-hydration DOM — and it can wipe a field *after* it was individually verified, while the
 * test is busy with the next one. Per-field retries lost that race twice; filling everything,
 * then checking everything, then repeating if anything was eaten, cannot lose it — once a
 * whole pass verifies, hydration is over, because hydration only strikes once.
 */
async function fillForm(fields: { locator: ReturnType<Page['getByLabel']>; value: string }[]) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const field of fields) await field.locator.fill(field.value);
    try {
      for (const field of fields) {
        await expect(field.locator).toHaveValue(field.value, { timeout: 1_000 });
      }
      return;
    } catch {
      // something was eaten mid-pass — hydration landed; the next pass sticks
    }
  }
  throw new Error('the form never held its values');
}

test.describe('the brother switch', () => {
  test('swaps the budget between the brothers, with the owner stated by the screen', async ({
    page,
  }) => {
    const yoni = `חשמל ${run}`;
    const evyatar = `דלק ${run}`;

    const add = async (label: string) => {
      const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
      if (await opener.isVisible().catch(() => false)) await opener.click();
      await fillForm([
        { locator: page.getByLabel(/label|תיאור/i), value: label },
        { locator: page.getByLabel(/amount|סכום/i), value: '120' },
      ]);
      await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
      await expect(page.getByText(label).first()).toBeVisible();
    };

    // On יוני's screen the form can only write to יוני — the owner is a statement, and the
    // statement is his name.
    await page.goto('/finance');
    await flip(page, 'יוני').click();
    await expect(page.locator('input[name="owner"]')).toHaveValue('יוני', { timeout: 10_000 });
    await add(yoni);

    await flip(page, 'אביתר').click();
    await expect(page.getByText(yoni), "יוני's money on אביתר's screen").toHaveCount(0);
    await expect(page.locator('input[name="owner"]')).toHaveValue('אביתר');
    await add(evyatar);

    await flip(page, 'יוני').click();
    await expect(page.getByText(yoni).first()).toBeVisible();
    await expect(page.getByText(evyatar)).toHaveCount(0);

    // The position is a cookie: it survives a reload.
    await page.reload();
    await expect(page.getByText(yoni).first()).toBeVisible();
    await expect(page.getByText(evyatar)).toHaveCount(0);
  });

  test('follows the same position on the study ledger', async ({ page }) => {
    const title = `קריאת גרפים ${run}`;

    await page.goto('/learning');
    await flip(page, 'יוני').click();

    const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
    if (await opener.isVisible().catch(() => false)) await opener.click();
    // Stated here too — the hidden field carries the switch's answer.
    await expect(page.locator('input[name="learner"]')).toHaveValue('יוני');
    await fillForm([
      { locator: page.getByLabel(/^what|מה נלמד/i), value: title },
      { locator: page.getByLabel(/^hours|שעות/i).first(), value: '2' },
    ]);
    await page.getByRole('button', { name: /^add$|^הוסף$/i }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    // The other brother's ledger does not hold this session.
    await flip(page, 'אביתר').click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test('offers exactly two positions', async ({ page }) => {
    // "Both" existed briefly and merged the ledgers. Asserted as an absence so it cannot
    // quietly return: a third button is a merged view of two private budgets.
    await page.goto('/finance');
    const group = page.getByRole('group', { name: /whose data|של מי הנתונים/i });
    await expect(group.getByRole('button')).toHaveCount(2);
  });

  test('stands down on the trading screens instead of pretending to filter', async ({ page }) => {
    await page.goto('/trades');
    const group = page.getByRole('group', { name: /whose data|של מי הנתונים/i });
    await expect(group, 'the switch is missing from the header').toBeVisible();

    // Dimmed and captioned: the wrapper says trading is shared. A pressed name that silently
    // changed nothing would read as data loss the first time somebody noticed.
    const wrapper = page.locator('form[data-tip]').filter({ has: group });
    await expect(wrapper).toHaveCount(1);
  });
});
