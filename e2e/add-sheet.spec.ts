import { expect, test, type Page } from '@playwright/test';

/**
 * The entry forms: inline on a wide screen, behind a button on a narrow one.
 *
 * Every screen that records something opened with its form. On a desktop that is right — three
 * or four fields across a row, and having it in front of you is the invitation to use it. On a
 * phone the same form is eight stacked fields and a button, which is most of a screen, and it
 * sits *above* the thing the screen is for: reading last month's expenses meant scrolling past
 * the form for adding one, every time.
 *
 * What is asserted is the pair, because either half alone is easy to get right and useless:
 * nothing to scroll past on a phone, and nothing hidden behind a tap on a desktop.
 */

const SCREENS = [
  { name: 'learning', path: '/learning' },
  { name: 'finance', path: '/finance' },
  { name: 'manual entry', path: '/long' },
] as const;

/** Fields the reader can actually see and type into. */
const visibleFields = (page: Page) =>
  page
    .locator('main input:not([type="hidden"]), main select, main textarea')
    .filter({ visible: true });

/**
 * The add button, by its own name.
 *
 * Not by `aria-haspopup="dialog"`: the range picker's trigger carries that too and comes first
 * in the document, so the obvious locator opened the range panel and reported this feature
 * working when it had not been touched.
 */
const addButton = (page: Page) =>
  page.getByRole('button', { name: /add (an entry|a trade|a position)/i });

test.describe('adding on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is the narrow layout');

  for (const screen of SCREENS) {
    test(`${screen.name} opens with a button, not a form`, async ({ page }) => {
      await page.goto(screen.path);

      await expect(addButton(page).first(), 'no add button').toBeVisible();
      expect(
        await visibleFields(page).count(),
        `${screen.path} still opens with its form spread down the page`,
      ).toBe(0);
    });

    test(`${screen.name} brings the whole form up when asked`, async ({ page }) => {
      await page.goto(screen.path);
      await addButton(page).first().click();

      const sheet = page.locator('[role="dialog"][aria-modal="true"]');
      await expect(sheet).toBeVisible();
      expect(await sheet.locator('input, select, textarea').count()).toBeGreaterThan(2);

      // And it closes again, leaving the page as it was.
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      expect(await visibleFields(page).count()).toBe(0);
    });
  }
});

test.describe('adding on a desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'this is the wide layout');

  for (const screen of SCREENS) {
    test(`${screen.name} keeps its form on the page`, async ({ page }) => {
      await page.goto(screen.path);

      expect(
        await visibleFields(page).count(),
        `${screen.path} hid its form behind a tap on a desktop`,
      ).toBeGreaterThan(2);
      await expect(addButton(page), 'the phone button is showing on a desktop').toHaveCount(0);
    });
  }
});
