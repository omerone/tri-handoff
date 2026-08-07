import { expect, test, type Page } from '@playwright/test';

/**
 * Being signed out for having gone away.
 *
 * The session ends after an hour without use, and the database is what enforces it — this
 * suite cannot wait an hour to watch that happen, and does not need to: the browser's copy of
 * the clock reads one value out of `localStorage`, so moving that value moves the deadline.
 * What is being tested is the behaviour around the deadline, not the arithmetic that finds it;
 * the hour itself is asserted in `src/lib/auth/session-limits`'s tests and the server's
 * refusal in `tests/integration/session-lifecycle.test.ts`.
 */

const IDLE_MS = 60 * 60 * 1000;
const KEY = 'tri:last-activity';

/** Pretend the last thing anyone did was `agoMs` ago. */
async function idleFor(page: Page, agoMs: number): Promise<void> {
  await page.evaluate(([key, when]) => localStorage.setItem(key as string, String(when)), [
    KEY,
    Date.now() - agoMs,
  ] as const);
}

const warningBanner = (page: Page) => page.locator('[role="status"]').filter({ hasText: /\d+/ });

/**
 * The one test that really ends the session gets its own sign-in.
 *
 * Every other spec shares the session saved by `auth.setup.ts`, and deleting that row would
 * sign out the rest of the suite — which is exactly what happened when this file first ran:
 * two tests that had nothing to do with signing out failed on a login page.
 */
test.describe('a tab left alone', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signs itself out and says why', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', process.env.SEED_EMAIL ?? 'demo@tri.local');
    await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? 'TriDemo2026!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/);

    await idleFor(page, IDLE_MS + 60_000);

    // The watcher ticks once a second, then hands over to a server action that deletes the
    // row — so this is a real sign-out, not a redirect with a live session left behind.
    await page.waitForURL(/\/login\?expired=idle/, { timeout: 15_000 });

    // And it is genuinely gone: a page behind the wall sends this browser back to the login
    // form rather than drawing the dashboard.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('the warning before it', () => {
  test('appears in the last minute, and takes an answer', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('main')).toBeVisible();

    await idleFor(page, IDLE_MS - 30_000);

    const warning = warningBanner(page);
    await expect(warning).toBeVisible({ timeout: 15_000 });

    // Saying "I'm still here" puts it away and keeps the session — including on the server,
    // which is what the refresh behind that button is for.
    await warning.getByRole('button').click();
    await expect(warning).toBeHidden();

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('stays out of the way of a tab that is being used', async ({ page }) => {
    await page.goto('/dashboard');

    // Half an hour is well inside the window: nothing should appear and nothing should end.
    await idleFor(page, IDLE_MS / 2);
    await page.waitForTimeout(2_000);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(warningBanner(page)).toHaveCount(0);
  });
});
