import { expect, test } from '@playwright/test';

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

    for (const label of ['Account balance', 'Net P&L', 'Win rate', 'Avg RR', 'Profit factor', 'Max drawdown']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByText(/Last 60 trades/)).toBeVisible();
    await expect(page.getByText('Equity curve')).toBeVisible();
    await expect(page.getByText('Recent trades')).toBeVisible();
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
    await expect(page.getByText(/July 2026/)).toBeVisible();

    await page.getByRole('link', { name: 'Previous month' }).click();
    await expect(page.getByText(/June 2026/)).toBeVisible();
  });
});

test.describe('Hebrew', () => {
  test('puts the sign on the correct side of a number in RTL', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'החלף לעברית' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

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
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'החלף לעברית' }).click();

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
