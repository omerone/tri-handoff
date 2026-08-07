import { expect, test, type Page } from '@playwright/test';

/**
 * The calendar's month heading, and the month before it.
 *
 * Read from the page rather than written down. The demo book is generated as a window ending
 * "now", so a spec that names a month is a spec that passes until the seed is next run — which
 * is exactly how "July 2026" came to be asserted in three places and wrong in all of them the
 * morning someone added trades dated today.
 */
const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, index, 15)),
  ),
);

async function shownMonth(page: Page): Promise<string> {
  const text = await page.locator('main').innerText();
  const found = text.match(new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`));
  if (!found) throw new Error(`no month heading on the page: ${text.slice(0, 120)}`);
  return `${found[1]} ${found[2]}`;
}

function monthBefore(label: string): string {
  const [name, year] = label.split(' ');
  const previous = new Date(Date.UTC(Number(year), MONTHS.indexOf(name as string) - 1, 15));
  return `${MONTHS[previous.getUTCMonth()]} ${previous.getUTCFullYear()}`;
}

/**
 * The time range, against the seeded demo book — a rolling window of trades ending today.
 *
 * The unit tests own the arithmetic — what the range resolves to, which days are inside it,
 * where the equity curve starts. What only a browser can show is whether the one control
 * actually reaches every screen, whether it survives a nav link that carries no query string,
 * and whether it composes with the filters a screen already had.
 */

/**
 * The picker's trigger, by what it controls rather than by what it says.
 *
 * It says two different things on purpose: "Custom range" from `lg`, where a segmented row of
 * presets sits beside it and this is only the other door — and the *active range itself* below
 * that, where it is the only control and its job is to answer "what am I looking at". A name
 * that changes with the viewport is not a handle a test can hold.
 */
const picker = (page: Page) => page.locator('button[aria-controls="tri-range-custom"]');

/**
 * A preset, wherever the current layout keeps it — and never the trigger.
 *
 * Below `lg` the trigger *is* named after the range, so "the visible button called Last month"
 * matches it once that range is chosen, and every assertion about a preset then lands on a
 * button that has no `aria-pressed` and never did. The trigger is the one carrying
 * `aria-controls`; excluding it is the whole of the distinction.
 */
const preset = (page: Page, name: string) =>
  page
    .getByRole('button', { name, exact: true })
    .and(page.locator('button:not([aria-controls])'))
    .filter({ visible: true });

/**
 * Choose a preset, whichever layout is drawing them.
 *
 * From `lg` they are a row and one click does it. Below that they live in the panel behind the
 * trigger, which is the entire point of the narrow layout — so the panel is opened first. A
 * test about what a *range* does should not have to know which of the two it is looking at.
 */
async function choose(page: Page, name: string) {
  if ((await preset(page, name).count()) === 0) await picker(page).click();
  await preset(page, name).click();
}

/**
 * That the picker is showing this range — which the two layouts say differently.
 *
 * The wide one lights the preset it is on, `aria-pressed` and all. The narrow one has no
 * presets on screen; its trigger *reads the range*, which is the same fact told in the only
 * way a single button can tell it. Asserting the desktop's spelling on a phone finds the
 * trigger — whose name is now the range — and fails on an attribute it was never going to have.
 */
async function expectShowing(page: Page, name: string) {
  const lit = preset(page, name);
  if ((await lit.count()) > 0) {
    await expect(lit).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(picker(page)).toContainText(name);
  }
}

test.describe('the picker', () => {
  test('is on every screen that reads a period, and on no others', async ({ page }) => {
    for (const path of ['/dashboard', '/analytics', '/trades', '/calendar', '/finance']) {
      await page.goto(path);
      // The trigger is the picker at every width; the presets are beside it or behind it.
      await expect(picker(page)).toBeVisible();
    }

    // Open positions are what is held right now, and Settings is not data at all.
    for (const path of ['/long', '/settings']) {
      await page.goto(path);
      await expect(picker(page)).toHaveCount(0);
    }
  });

  test('puts the chosen range in the URL, so it can be shared', async ({ page }) => {
    await page.goto('/dashboard');
    await choose(page, 'Last month');
    await expect(page).toHaveURL(/range=last-month/);
  });

  test('follows a nav link that carries no query string of its own', async ({ page }) => {
    // The whole reason the range is mirrored into a cookie: `<Link href="/trades">` has no
    // idea a range exists, and threading one through every link in the product would mean
    // every future link remembering to.
    await page.goto('/analytics');
    await choose(page, 'Last month');

    await page.getByRole('link', { name: 'Trades', exact: true }).click();
    await expect(page).toHaveURL(/\/trades$/);
    await expectShowing(page, 'Last month');
  });

  test('honours a shared link over the reader’s own cookie', async ({ page }) => {
    await page.goto('/dashboard');
    await choose(page, 'Last month');

    // Arriving with an explicit range: what the link says wins, or the recipient is quietly
    // shown a different month than the person who sent it.
    await page.goto('/dashboard?range=max');
    await expectShowing(page, 'Maximum');
    await expect(page).toHaveURL(/range=max/);
  });
});

test.describe('what the range does to a screen', () => {
  test('narrows the trades table and its summary', async ({ page }) => {
    await page.goto('/trades');
    const all = Number((await page.locator('main').innerText()).match(/(\d+) trades/)![1]);

    await choose(page, 'Last month');
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
    await choose(page, 'Last month');

    await expect(page).toHaveURL(/class=crypto/);
    await expect(page).toHaveURL(/range=last-month/);
    await expect(page).not.toHaveURL(/page=2/);
  });

  test('says the window is empty rather than offering to connect a broker', async ({ page }) => {
    // A window years before the demo book, rather than a preset that is only empty until
    // someone seeds a trade dated today. The all-time empty state invites the user to connect
    // an account they already have, which reads as the sync having failed.
    await page.goto('/dashboard?range=2021-03..2021-03');
    await expect(page.getByText('No data in the selected range')).toBeVisible();
    await expect(page.getByText(/Connect your MT5 account/)).toHaveCount(0);
  });

  test('turns the calendar into the months it covers', async ({ page }) => {
    await page.goto('/calendar?range=2026-05..2026-07');

    // Newest first, and every month in the range. Scoped to `main`: the picker's own summary
    // names the same months, which is the point of it, and it sits outside `main` so that
    // asking whether the calendar shows July does not also find the picker saying so.
    for (const month of ['July 2026', 'June 2026', 'May 2026']) {
      await expect(page.locator('main').getByText(new RegExp(month))).toBeVisible();
    }

    // Arriving on a custom range opens the panel — see 'opens showing the bounds it is
    // responsible for'. On a phone it is 290px of month fields laid over the first card, so
    // it has to be dismissed before anything under it can be reached, which is what a person
    // does. Escape rather than a click elsewhere: a click would land on a card.
    await page.keyboard.press('Escape');

    // The arrows shift the window rather than escaping it. They used to be absent here, on
    // the reasoning that stepping out of the range would show a month the picker says is not
    // selected — true, and it left a calendar with a range on it unable to reach last month
    // at all. Moving the range keeps the picker honest and the arrow obvious.
    await page.getByRole('link', { name: 'Previous month' }).click();
    for (const month of ['June 2026', 'May 2026', 'April 2026']) {
      await expect(page.locator('main').getByText(new RegExp(month))).toBeVisible();
    }
    await expect(page.locator('main').getByText(/July 2026/)).toHaveCount(0);
  });

  test('leaves the calendar browsable when nothing is pinned down', async ({ page }) => {
    await page.goto('/calendar?range=max');
    const opened = await shownMonth(page);

    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.locator('main').getByText(monthBefore(opened))).toBeVisible();
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
  /*
   * By what the button controls, not by what it says.
   *
   * It says two different things on purpose now: "Custom range" from `lg`, where a segmented
   * row of presets sits beside it and this is only the other door — and the *active range
   * itself* below that, where it is the only control and its job is to answer "what am I
   * looking at". A name that changes with the viewport is not a handle a test can hold.
   */
  const picker = (page: Page) => page.locator('button[aria-controls="tri-range-custom"]');
  const open = (page: Page) => picker(page).click();

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
    await expect(picker(page)).toBeFocused();
  });

  test('dismisses on a click elsewhere', async ({ page }) => {
    await page.goto('/dashboard');
    await open(page);

    // The footer, not the top of `main`: at 412px the popover is most of the width and hangs
    // over the first thing on the page, so a click there lands *inside* it.
    await page.locator('footer').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('closes when a preset answers the question instead', async ({ page }) => {
    // The panel used to stay open across the navigation, leaving a form full of month fields
    // standing under a picker that says the range is everything.
    await page.goto('/dashboard?range=2026-05..2026-07');
    await expect(page.locator('select[name="fromMonthMonth"]')).toBeVisible();

    await choose(page, 'Maximum');
    await expect(page).toHaveURL(/range=max/);
    await expect(page.locator('select[name="fromMonthMonth"]')).toHaveCount(0);
    await expect(picker(page)).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('the R-strip under a wide range', () => {
  // June through August is 92 days, which is the widest strip the dashboard will draw.
  const WIDE = '/dashboard?range=2026-06..2026-08';

  test('drops the per-day dates once they would overprint each other', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the strip is a list on a phone');

    await page.goto(WIDE);
    const strip = page.locator('[data-widget="rStrip"]');
    await expect(strip.getByText(/Last 92 days/).filter({ visible: true })).toBeVisible();

    // Ninety-two `dd/MM` labels in the width of a card is a grey smear, not a scale. What is
    // left is the span: the first and last date, and nothing between them.
    const figures = strip.locator('span.tri-num:visible');
    await expect(figures).toHaveCount(2);
  });

  test('still gives every day its date, on hover', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the strip is a list on a phone');

    await page.goto(WIDE);
    const strip = page.locator('[data-widget="rStrip"]');
    const cards = strip.locator('[role="tooltip"]');
    await expect(cards).toHaveCount(92);

    const card = cards.nth(45);
    await expect(card).toBeHidden();
    await cards.nth(45).locator('..').hover();
    // The weekday and the full date — more than the column ever carried.
    await expect(card).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  });

  test('keeps the hover cards on screen even when the columns are 8px wide', async ({ page }) => {
    // The clearance at each end is measured in columns, so it has to grow as the columns
    // shrink: five columns clear a card at thirty days and 40px at ninety-two.
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the strip is a list on a phone');

    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto(WIDE);
    const columns = page.locator('[data-widget="rStrip"] [role="tooltip"]');
    const total = await columns.count();

    // Every column in the anchoring region, not five samples of it. The card is `w-max`, so
    // its width depends on the day — a quiet day's card is half the size of a busy one's, and
    // sampling happened to land on the narrow ones and pass against a clearance that was too
    // small. The boundary is where the bug lives, so the test walks all of it.
    const window = 16;
    const indices = [
      ...Array.from({ length: window }, (_, i) => i),
      Math.floor(total / 2),
      ...Array.from({ length: window }, (_, i) => total - 1 - i),
    ];

    for (const index of indices) {
      await columns.nth(index).locator('..').focus();
      const card = columns.nth(index);
      await expect(card).toBeVisible();
      const box = (await card.boundingBox())!;
      expect(box.x, `column ${index} runs off the start`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `column ${index} runs off the end`).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
  });
});
