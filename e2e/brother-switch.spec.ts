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
 * Open the add sheet — or find the form already inline — surviving hydration.
 *
 * On a phone the form is behind an "Add an entry" button whose onClick only exists after
 * hydration; a click before that is swallowed whole, and no amount of asserting on
 * server-rendered attributes proves the handler is attached (aria-pressed is true in the
 * first HTML byte). The only evidence that the click worked is the form becoming visible,
 * so this clicks until it is.
 */
async function openForm(page: Page, field: ReturnType<Page['getByLabel']>) {
  const opener = page.getByRole('button', { name: /add an entry|הוספת רשומה/i }).first();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await field.isVisible().catch(() => false)) return;
    if (await opener.isVisible().catch(() => false)) await opener.click();
    try {
      await expect(field).toBeVisible({ timeout: 2_000 });
      return;
    } catch {
      // swallowed by pre-hydration DOM — go again
    }
  }
  throw new Error('the form never became visible');
}

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

/**
 * Every form on the screen states the same brother.
 *
 * There is more than one now — the ledger writes an entry, the card below it writes a budget
 * ceiling — and each carries its own hidden owner. Checking only the first would leave the
 * other free to file אביתר's allowance under יוני, which is the exact confusion the switch
 * exists to prevent, and it would not show on screen until the money was already in the wrong
 * book. The first field gets the long timeout: that is the one waiting for the flip to land.
 */
async function ownedBy(page: Page, brother: string) {
  const owners = page.locator('input[name="owner"]');
  await expect(owners.first()).toHaveValue(brother, { timeout: 10_000 });
  for (const owner of await owners.all()) await expect(owner).toHaveValue(brother);
}

test.describe('the brother switch', () => {
  test('swaps the budget between the brothers, with the owner stated by the screen', async ({
    page,
  }) => {
    const yoni = `חשמל ${run}`;
    const evyatar = `דלק ${run}`;

    const add = async (label: string) => {
      await openForm(page, page.getByLabel(/label|תיאור/i));
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
    await ownedBy(page, 'יוני');
    await add(yoni);

    await flip(page, 'אביתר').click();
    await expect(page.getByText(yoni), "יוני's money on אביתר's screen").toHaveCount(0);
    await ownedBy(page, 'אביתר');
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
    /* Scoped to the form: page-wide, "Hours…" also matches the donut above the list, which
       is named for a screen reader exactly the way a field is. */
    const studyForm = page.locator('form:has(input[name="topic"]), form:has(select[name="topic"])');
    await openForm(page, studyForm.getByLabel(/^what|מה נלמד/i).first());
    // Stated here too — the hidden field carries the switch's answer.
    await expect(page.locator('input[name="learner"]')).toHaveValue('יוני');
    await fillForm([
      { locator: studyForm.getByLabel(/^what|מה נלמד/i).first(), value: title },
      { locator: studyForm.getByLabel(/^hours|שעות/i).first(), value: '2' },
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
