import { expect, test, type Page } from '@playwright/test';
import { openAddForm } from './helpers/add-form';
import { PrismaClient } from '@prisma/client';

/**
 * Picking rows and removing them together, on the three lists that grew it after the trades
 * table did.
 *
 * The same component drives all of them, so what is worth asserting per screen is that it is
 * *wired* — the button is there, the boxes appear under it, "select all" reaches every row on
 * screen and no further. The behaviour itself (boxes absent until asked for, the selection
 * dropped on leaving the mode) is covered once in trade-selection.spec.ts rather than four
 * times here.
 *
 * The delete is driven on a row this file creates, on the screen where creating one is a form
 * fill rather than a broker sync. Deleting from the seeded book would quietly change the
 * numbers every other spec asserts on.
 */

const SCREENS = [
  { name: 'finance', path: '/finance' },
  { name: 'learning', path: '/learning' },
  { name: 'manual entry', path: '/long' },
] as const;

/**
 * Located by what they are, not by what tag they happen to be.
 *
 * `input[type="checkbox"]` also matches the finance form's "repeats every month" box, and
 * `button` named Delete also matches the per-row delete every one of these lists already had —
 * five of them on the finance screen. Both were counted as the selection's own on the first
 * attempt, and both reported a screen as being in a state it was not.
 */
const boxes = (page: Page) => page.locator('main [data-bulk-select]').filter({ visible: true });
const actionBar = (page: Page) => page.locator('[data-bulk-bar]');

/**
 * The learning book starts empty in the seed, and a list with no rows has nothing to select —
 * correctly, so the button is not drawn. One row makes the screen comparable to the other two.
 */
const SEEDED = 'E2ESEED';

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  try {
    // The demo user by name, not the first row: the integration fixtures leave other users
    // behind and a row on one of those is a row the browser is not signed in to see.
    const user = await prisma.user.findFirstOrThrow({
      where: { email: process.env.SEED_EMAIL ?? 'demo@tri.local' },
      select: { id: true },
    });
    await prisma.learningEntry.deleteMany({ where: { title: { startsWith: SEEDED } } });
    await prisma.learningEntry.create({
      data: {
        userId: user.id,
        title: `${SEEDED} entry`,
        topic: 'technical',
        // Always a brother: the two-position switch shows only his rows, so a null learner
        // here would seed a row the page under test cannot display.
        learner: 'יוני',
        hours: 1,
        learnedOn: new Date('2026-07-01T00:00:00.000Z'),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.learningEntry.deleteMany({ where: { title: { startsWith: SEEDED } } });
  } finally {
    await prisma.$disconnect();
  }
});

test.describe('picking rows to delete', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} offers it, and draws no boxes until it is asked for`, async ({ page }) => {
      await page.goto(screen.path);
      const select = page.getByRole('button', { name: 'Select' });
      await expect(select, `${screen.path} has no Select button`).toBeVisible();
      await expect(boxes(page), `${screen.path} arrived in selection mode`).toHaveCount(0);

      await select.click();
      const shown = await boxes(page).count();
      expect(shown, `${screen.path} showed no boxes after Select`).toBeGreaterThan(0);

      await page.getByRole('button', { name: 'Done' }).click();
      await expect(
        boxes(page),
        `${screen.path} hid the boxes rather than removing them`,
      ).toHaveCount(0);
    });

    test(`${screen.name} can take everything on screen at once`, async ({ page }) => {
      await page.goto(screen.path);
      await page.getByRole('button', { name: 'Select' }).click();

      // The first box is "select all" wherever the screen puts it — the header of a table, or
      // the row above a list.
      const all = boxes(page).first();
      const rows = (await boxes(page).count()) - 1;
      expect(rows, `${screen.path} has no rows to pick`).toBeGreaterThan(0);

      await all.check();
      await expect(page.getByText(new RegExp(`${rows}\\s+rows? selected`, 'i'))).toBeVisible();

      await all.uncheck();
      await expect(actionBar(page), 'the bar stayed up with nothing picked').toHaveCount(0);
    });
  }
});

test.describe('removing what was picked', () => {
  const TOPIC = 'E2EBULK';

  test.afterEach(async ({ page }) => {
    // Whatever survived a failure goes, so a red run does not leave rows for the next one.
    await page.goto('/learning');
    for (let i = 0; i < 4; i++) {
      const row = page.locator('li').filter({ hasText: TOPIC }).first();
      if ((await row.count()) === 0) break;
      await row.getByRole('button').last().click();
      await page.waitForTimeout(300);
    }
  });

  test('takes two learning entries in one press', async ({ page }) => {
    /*
     * At a desktop width, on both projects, and on purpose.
     *
     * What this test is about is removing rows together — creating them first is setup. Below
     * `md` that setup goes through a sheet that opens, closes itself on submit and has to be
     * reopened per row, which is behaviour `add-sheet.spec.ts` covers directly and which this
     * file would otherwise be re-testing by accident, three assertions at a time.
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/learning');
    await openAddForm(page, /add an entry/i);
    const form = page
      .locator('form')
      .filter({ has: page.locator('input[name="title"]') })
      .filter({ visible: true })
      .first();

    for (const hours of ['1', '2']) {
      await form.locator('input[name="title"]').fill(`${TOPIC} ${hours}`);
      await form.locator('input[name="hours"]').fill(hours);
      await form.getByRole('button', { name: 'Add' }).click();
      // The row in the list, not any text on the page: below `md` the sheet closes on submit
      // and the form's own copy of the title goes with it.
      await expect(
        page
          .locator('main li')
          .filter({ hasText: `${TOPIC} ${hours}` })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    await page.getByRole('button', { name: 'Select' }).click();
    for (const hours of ['1', '2']) {
      await page
        .locator('li')
        .filter({ hasText: `${TOPIC} ${hours}` })
        .locator('[data-bulk-select]')
        .check();
    }

    await expect(page.getByText(/2 rows selected/i)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await actionBar(page)
      .getByRole('button', { name: /^Delete$/ })
      .click();

    // Both gone, and the mode closed itself rather than leaving an armed bar over an empty list.
    await expect(page.getByText(`${TOPIC} 1`)).toHaveCount(0);
    await expect(page.getByText(`${TOPIC} 2`)).toHaveCount(0);
    await expect(boxes(page)).toHaveCount(0);
  });
});
