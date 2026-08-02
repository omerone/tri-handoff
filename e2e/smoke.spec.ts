import { expect, test } from '@playwright/test';

/**
 * P0 smoke: the tenant boundary, the login wall, and the language switch.
 *
 * Requires the seeded demo tenant (`npm run db:seed`), which owns `demo.localhost`.
 */

const EMAIL = process.env.SEED_EMAIL ?? 'demo@tri.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'TriDemo2026!';

const port = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:3100').port;
const unknownHost = `http://localhost:${port}`;

test.describe('tenant boundary', () => {
  test('a host that is not a client gets a 404 explaining why', async ({ page }) => {
    const response = await page.goto(`${unknownHost}/login`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/TRi client|חשבון TRi/)).toBeVisible();
  });

  test('a client host serves the sign-in page', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });
});

test.describe('admin panel', () => {
  test('is not reachable from a client domain', async ({ page }) => {
    const response = await page.goto('/admin/login');
    expect(response?.status()).toBe(404);
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
  });

  test('is served on the platform base domain', async ({ page }) => {
    const response = await page.goto(`${unknownHost}/admin/login`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /super admin/i })).toBeVisible();
  });
});

test.describe('login wall', () => {
  test('an anonymous request to the dashboard lands on sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a wrong password is refused without saying which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', 'definitely-not-the-password');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the right password reaches the dashboard and signing out reverses it', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: /דשבורד|Dashboard/ })).toBeVisible();

    await page.locator('button[aria-label="התנתקות"], button[aria-label="Sign out"]').click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('theme', () => {
  test('is dark by default and switches to light', async ({ page }) => {
    // SPEC §1.1 asks for a light mode alongside the dark default. The theme is applied from
    // a cookie in the root layout, so it is correct on the very first paint — including on
    // the sign-in screen, before there is a session to read it from.
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const background = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    const dark = await background();

    await page.context().addCookies([
      { name: 'tri_theme', value: 'light', url: page.url() },
    ]);
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await background()).not.toBe(dark);
  });
});

test.describe('language', () => {
  test('defaults to Hebrew RTL and switches to English LTR', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');

    await page.getByRole('button', { name: 'Switch to English' }).click();

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Sign in to TRi' })).toBeVisible();
  });
});
