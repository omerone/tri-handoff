import { expect, test, type Page } from '@playwright/test';

/**
 * What the client router cache still holds after the session behind it ends.
 *
 * `next.config.ts` sets `staleTimes: { dynamic: 30 }` — a visited tab stays in the browser's
 * router cache for thirty seconds, so a second click on the same tab renders with no request
 * at all. That is a deliberate, measured win: 21 tab switches cost 7 server renders instead
 * of 21. It is also, on its face, a way for a rendered trading book to outlive the session
 * that was allowed to see it.
 *
 * The case that matters is not the Back button — that is a full navigation and the server
 * answers it. It is a *client-side* navigation made after the session ended: a nav link
 * clicked in one tab while another tab has signed out, on the shared laptop this product is
 * plausibly used on. If the cache answers that click, the numbers appear with no session.
 */

const EMAIL = process.env.SEED_EMAIL ?? 'demo@tri.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'TriDemo2026!';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('a tab left open cannot keep reading the book after another tab signs out', async ({
  context,
}) => {
  const left = await context.newPage();
  await signIn(left);

  // Warm the cache the way a user does: visit the tabs, then come back. Every one of these is
  // now a rendered payload sitting in the browser, inside its thirty seconds.
  for (const path of ['/trades', '/finance', '/dashboard']) await left.goto(path);
  await expect(left.locator('main')).toBeVisible();

  // A second tab, same browser, same cookies — and it signs out.
  const right = await context.newPage();
  await right.goto('/settings');
  await right.locator('button[aria-label="התנתקות"], button[aria-label="Sign out"]').click();
  await expect(right).toHaveURL(/\/login$/);

  // Back in the first tab, which still believes it is signed in: a client-side navigation,
  // the kind the router cache exists to answer. Immediately, well inside the window.
  await left.getByRole('link', { name: /עסקאות|Trades/ }).first().click();
  await left.waitForLoadState('networkidle');

  expect(left.url(), 'a client-side click served an app screen with no session').toMatch(
    /\/login/,
  );
});
