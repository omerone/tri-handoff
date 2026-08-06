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
 * The P1 screens, against the seeded demo book (92 trades from the mock provider).
 *
 * The assertions are mostly about *consistency between screens* rather than exact figures:
 * the numbers themselves are covered exhaustively by the analytics invariant tests, and
 * pinning them here would only mean two places to update. What unit tests cannot see is
 * whether the dashboard, the trades table and the calendar are all reading the same book —
 * or whether Hebrew renders a minus sign on the wrong side of a number.
 */

/**
 * The session and the connected MT5 account come from e2e/auth.setup.ts, which runs once for
 * the whole suite. Logging in per test would exhaust the login rate limiter long before the
 * suite finished — and the limiter is a real protection that the tests should run against
 * rather than around.
 */

test.describe('dashboard', () => {
  test('shows the KPI row, the R-strip and the equity curve', async ({ page }) => {
    await page.goto('/dashboard');

    // Scoped to each tile rather than searched page-wide: the strip's hover cards reuse
    // these same labels, so a bare `getByText('Net P&L')` now matches nineteen elements.
    for (const [widget, label] of [
      ['balance', 'Account balance'],
      ['netPnl', 'Net P&L'],
      ['winRate', 'Win rate'],
      ['avgRr', 'Avg RR'],
      ['profitFactor', 'Profit factor'],
      ['maxDd', 'Max drawdown'],
    ] as const) {
      await expect(
        page.locator(`[data-widget="${widget}"]`).getByText(label, { exact: true }),
      ).toBeVisible();
    }

    // Days, not trades: "the last sixty trades" was a different span every time it was read.
    // The strip's card draws its header twice — a plain one for the wide layout and a
    // disclosure button for the phone, each hidden at the other's width — so the title matches
    // twice in the DOM and only once on screen. This asserts the one that is actually shown.
    const strip = page.locator('[data-widget="rStrip"]');
    await expect(strip.getByText(/Last 30 days/).filter({ visible: true })).toBeVisible();
    await expect(strip.getByText(/trading days?$/).filter({ visible: true })).toBeVisible();
    await expect(page.locator('[data-widget="equity"]').getByText('Equity curve')).toBeVisible();
    await expect(page.locator('[data-widget="recent"]').getByText('Recent trades')).toBeVisible();
  });

  test('lets the user rearrange the grid, and remembers it', async ({ page }) => {
    // SPEC §1.1: the user builds their own layout. What a unit test cannot check is that the
    // arrangement actually survives the round trip through the database and comes back on
    // the next page load, which is the whole point of storing it.
    //
    // The arrangement is stored on the shared demo account, so this test starts by putting it
    // back to the default rather than assuming it. Otherwise one failed run leaves the layout
    // half-moved and every run after it fails for a reason that has nothing to do with the code.
    await page.goto('/dashboard');
    const order = () =>
      page
        .locator('[data-widget]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.widget));
    const edit = page.getByRole('button', { name: 'Edit layout' });
    const resetToDefault = page.getByRole('button', { name: 'Reset to default' });
    const saved = page.getByText('Layout saved');

    await edit.click();
    if (await resetToDefault.isEnabled()) {
      await resetToDefault.click(); // Resetting also leaves edit mode.
      await expect(saved).toBeAttached();
      await edit.click();
    }

    const before = await order();
    expect(before[0]).toBe('balance');

    const handle = page.getByRole('button', { name: /^Move Account balance,/ });
    await expect(handle).toBeVisible();

    // Two nudges with the keyboard. The drag has nothing to fall back on for anyone not using
    // a mouse, so this is the path that has to keep working.
    await handle.press('ArrowRight');
    await handle.press('ArrowRight');
    expect(await order()).toEqual(['netPnl', 'winRate', 'balance', ...before.slice(3)]);

    // Width is a desktop decision — at 375px a 3-of-12 tile would be 90 pixels wide — so
    // below the breakpoint the control is not offered at all rather than offered and inert.
    // An enabled button that changes a readout and saves while the card in front of the user
    // does not move is worse than no button.
    // Exact: the "Account balance over time" panel's own widen button starts with the same
    // words, and a prefix match resolves to both.
    const widen = page.getByRole('button', { name: 'Widen Account balance', exact: true });
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    if (wide) await widen.click();
    else await expect(widen).toHaveCount(0);

    // The arrangement is written on a trailing debounce, so reloading straight away would
    // race the request rather than test it. The status line is what tells the user it landed.
    await expect(saved).toBeAttached();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.reload();
    expect(await order()).toEqual(['netPnl', 'winRate', 'balance', ...before.slice(3)]);
    await expect(page.locator('[data-widget="balance"]')).toHaveCSS(
      'grid-column-start',
      wide ? 'span 3' : 'span 6',
    );

    await edit.click();
    await resetToDefault.click();
    await expect(saved).toBeAttached();
    await page.reload();
    expect(await order()).toEqual(before);
  });

  test('takes the width back from the user below the desktop breakpoint', async ({ page }) => {
    // Order is the user's at every size; width is theirs only where there is room. The rung
    // values are unit-tested, but only the browser can show that the media queries actually
    // produce them — and nothing else in the suite ever renders at the tablet tier, where a
    // panel dropping to half width puts the equity chart's axis labels on top of each other.
    //
    // Independent of the stored arrangement on purpose: below 1024px the chosen span is not
    // read at all, so these hold whatever the demo account's layout happens to be.
    await page.goto('/dashboard');
    const kpi = page.locator('[data-widget="balance"]');
    const panel = page.locator('[data-widget="equity"]');

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(kpi).toHaveCSS('grid-column-start', 'span 4'); // three-up on a tablet
    await expect(panel).toHaveCSS('grid-column-start', 'span 12');

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(kpi).toHaveCSS('grid-column-start', 'span 6'); // two-up on a phone
    await expect(panel).toHaveCSS('grid-column-start', 'span 12');
  });

  test('keeps an arrangement the user navigates away from before the debounce fires', async ({
    page,
  }) => {
    // The write is on a trailing debounce and leaving the page cancels the timer, so without
    // the flush on unmount this is a rearrangement the user watched happen and then lost.
    // The test above always waits for "Layout saved" first, so it only ever covers the
    // debounce path; this is the other one, and deleting the flush must fail something.
    await page.goto('/dashboard');
    const order = () =>
      page
        .locator('[data-widget]')
        .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.widget));

    const edit = page.getByRole('button', { name: 'Edit layout' });
    const resetToDefault = page.getByRole('button', { name: 'Reset to default' });

    await edit.click();
    if (await resetToDefault.isEnabled()) {
      await resetToDefault.click();
      await expect(page.getByText('Layout saved')).toBeAttached();
      await edit.click();
    }
    const before = await order();

    // Matched by the server-action header rather than by URL: the flush happens while the
    // router is already unmounting, so the request carries whichever route it has arrived at
    // by then. Waiting on it is what makes this a test of the write rather than a race.
    const written = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.request().headers()['next-action'] !== undefined,
    );
    await page.getByRole('button', { name: /^Move Account balance,/ }).press('ArrowRight');
    // Exact, or this also matches "Long Trades".
    await page.getByRole('link', { name: 'Trades', exact: true }).click(); // inside the window
    await written;

    await page.goto('/dashboard');
    expect(await order()).toEqual([before[1], before[0], ...before.slice(2)]);

    await edit.click();
    await resetToDefault.click();
    await expect(page.getByText('Layout saved')).toBeAttached();
  });

  test('gives every day in the strip its own detail on hover', async ({ page }) => {
    // The strip is thirty columns of bar and a date; the day's actual numbers live in a hover
    // card. It replaced the browser's `title`, which took a second to appear and — being one
    // flat string — reordered its own parts inside the Hebrew layout.
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the strip is a list on a phone');

    await page.goto('/dashboard');
    const strip = page.locator('[data-widget="rStrip"]');
    const columns = strip.locator('[role="tooltip"]');
    await expect(columns).toHaveCount(30);

    // Hidden until asked for.
    await expect(columns.first()).toBeHidden();

    const column = columns.nth(15).locator('..');
    await column.hover();
    const card = columns.nth(15);
    await expect(card).toBeVisible();
    // A weekday, the date in the product's order, and the day's figures.
    await expect(card).toContainText(/\d{2}\/\d{2}\/\d{4}/);

    // Reachable without a mouse — a hover-only affordance would not be.
    await page.keyboard.press('Escape');
    await column.focus();
    await expect(card).toBeVisible();
  });

  test('keeps every hover card inside the viewport, at both ends', async ({ page }) => {
    // A card centred on its column hangs off the strip at the ends. The first attempt at
    // clamping used physical `left`/`right`, which is inverted in Hebrew — it pinned the
    // outer cards to the wrong edge and pushed them further off screen than before.
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'the strip is a list on a phone');

    // Two conditions, both required to see the bug this guards against.
    //
    // Hebrew: the rest of the suite runs in English, and the first clamp used physical
    // `left`/`right`, which is *correct* in a left-to-right layout. The card only flew off
    // the wrong edge in RTL, so an English-only test passed while the Hebrew product — the
    // default locale — was broken.
    //
    // 768px: the narrowest width the strip renders at. At 1280 the page margins absorb an
    // overhanging card, so it looked fine there while being 34px off screen in a split window.
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/dashboard');
    await page.context().addCookies([{ name: 'tri_locale', value: 'he', url: page.url() }]);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const columns = page.locator('[data-widget="rStrip"] [role="tooltip"]');
    const total = await columns.count();

    for (const index of [0, 1, Math.floor(total / 2), total - 2, total - 1]) {
      await columns.nth(index).locator('..').focus();
      const card = columns.nth(index);
      await expect(card).toBeVisible();
      const box = (await card.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.x, `column ${index} runs off the start`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `column ${index} runs off the end`).toBeLessThanOrEqual(width + 1);
    }
  });

  test('reports RR coverage next to the RR figure', async ({ page }) => {
    // RR is the client's headline metric; a coverage figure that stopped rendering would
    // leave an average over an unknown share of the book looking authoritative.
    await page.goto('/dashboard');
    await expect(page.getByText(/% of trades have an SL/)).toBeVisible();
  });
});

test.describe('cross-screen consistency', () => {
  test('the trade count agrees between the dashboard and the trades table', async ({ page }) => {
    await page.goto('/dashboard');
    const dashboardText = (await page.locator('main').innerText()).match(/(\d+) trades/);
    expect(dashboardText).not.toBeNull();

    await page.goto('/trades');
    const tableText = (await page.locator('main').innerText()).match(/(\d+) trades/);
    expect(tableText).not.toBeNull();
    expect(tableText![1]).toBe(dashboardText![1]);
  });
});

test.describe('trades table', () => {
  test('filters through the URL and keeps the selection', async ({ page }) => {
    await page.goto('/trades?class=crypto&dir=short');

    // Every visible row matches the filter.
    const sides = await page.locator('tbody tr td:nth-child(4)').allInnerTexts();
    expect(sides.length).toBeGreaterThan(0);
    expect(sides.every((side) => side.includes('Short'))).toBe(true);

    const symbols = await page.locator('tbody tr td:nth-child(2)').allInnerTexts();
    expect(symbols.every((symbol) => /BTC|ETH|SOL/.test(symbol))).toBe(true);
  });

  test('narrowing the filter narrows the summary', async ({ page }) => {
    await page.goto('/trades');
    const all = (await page.locator('main').innerText()).match(/(\d+) trades/)![1];

    await page.goto('/trades?class=crypto');
    const crypto = (await page.locator('main').innerText()).match(/(\d+) trades/)![1];

    expect(Number(crypto)).toBeGreaterThan(0);
    expect(Number(crypto)).toBeLessThan(Number(all));
  });

  test('shows an empty state rather than an empty page when nothing matches', async ({ page }) => {
    await page.goto('/trades?class=other');
    await expect(page.getByText(/No trades match these filters/)).toBeVisible();
  });
});

test.describe('analytics', () => {
  test('renders every breakdown and a full heatmap', async ({ page }) => {
    await page.goto('/analytics');

    await expect(page.getByText('Where you are most profitable')).toBeVisible();
    for (const title of ['P&L by weekday', 'By trading session', 'By asset class', 'By direction']) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    // 5 weekdays × 3 sessions, always present so a gap reads as a gap.
    const heatmapText = await page.locator('main').innerText();
    for (const session of ['Asia', 'London', 'New York']) {
      expect(heatmapText).toContain(session);
    }
  });

  test('names weekdays unambiguously', async ({ page }) => {
    // "M" and "T" alone are unreadable in an insight card, and English has two "T" days.
    await page.goto('/analytics');
    const text = await page.locator('main').innerText();
    expect(text).toMatch(/Mon|Tue|Wed|Thu|Fri/);
  });
});

test.describe('calendar', () => {
  test('opens on the month of the most recent trade and navigates', async ({ page }) => {
    await page.goto('/calendar');
    const opened = await shownMonth(page);

    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.locator('main').getByText(monthBefore(opened))).toBeVisible();
  });

  test('still steps a month when a range is chosen', async ({ page }) => {
    // The arrows used to disappear the moment a range was picked, on the reasoning that
    // stepping out of it would show a month the picker says is not selected. That left the
    // screen with no way to reach last month at all: someone on "this month" had to reopen
    // the picker and build a custom range for the most ordinary move a calendar has. They
    // shift the range itself now, so the picker above stays true to what is on screen.
    await page.goto('/calendar?range=this-month');
    const opened = await shownMonth(page);

    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.locator('main').getByText(monthBefore(opened))).toBeVisible();
    // The range moved with it, rather than the month escaping the range.
    expect(page.url()).toMatch(/range=\d{4}-\d{2}\.\.\d{4}-\d{2}/);
  });
});

test.describe('Hebrew', () => {
  test('puts the sign on the correct side of a number in RTL', async ({ page }) => {
    // Through Settings: the one-tap language switch is no longer in the header.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'עברית', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Back to the screen whose numbers this is about — the switch is a detour now, not the
    // first thing on the page under test.
    await page.goto('/dashboard');

    // Without an LTR isolate, bidi lays "-₪2,085" out as "₪2,085-", which a trader reads as
    // a positive number. Every number is wrapped in dir="ltr" for exactly this reason, so
    // the signed ones must still begin with their sign.
    const numbers = await page.locator('main [dir="ltr"]').allInnerTexts();
    // Intl prefixes a negative number with U+200E in Hebrew — an invisible mark that pins the
    // sign to the left. It is correct and belongs there; it is just not a character, so it is
    // stripped before checking where the sign actually sits.
    const withoutBidiMarks = (value: string) => value.replace(/[\u200e\u200f\u2066-\u2069]/g, '').trim();

    const signed = numbers.map(withoutBidiMarks).filter((value) => /[+-]/.test(value));
    expect(signed.length).toBeGreaterThan(0);
    for (const value of signed) {
      // A sign anywhere other than the front means the LTR isolate was lost.
      expect(value).toMatch(/^[+-]/);
    }
  });

  test('renders every P1 screen in Hebrew without falling back to keys', async ({ page }) => {
    // Through Settings: the one-tap language switch is no longer in the header.
    await page.goto('/settings');
    await page.getByRole('button', { name: 'עברית', exact: true }).click();

    for (const path of ['/dashboard', '/analytics', '/trades', '/calendar', '/settings']) {
      await page.goto(path);
      const text = await page.locator('main').innerText();
      // next-intl renders the key itself when a message is missing; a dotted key in the
      // output is a missing translation.
      expect(text).not.toMatch(/\b(kpi|dash|analytics|table|settings|enum)\.[a-zA-Z.]+/);
      expect(text.length).toBeGreaterThan(20);
    }
  });
});
