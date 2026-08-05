import { expect, test as setup } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * Signs in once, connects the demo MT5 account, and saves the session for every test that
 * needs one.
 *
 * Without this each test logs in for itself, and the suite runs straight into the login rate
 * limiter — ten attempts per fifteen minutes, against several dozen tests. Raising the limit
 * for tests would be the wrong fix: it is a real protection and the suite should run against
 * the real one. Signing in once is also what a user actually does.
 *
 * The smoke suite deliberately does *not* use this state — it tests the login wall itself.
 */

export const STORAGE_STATE = 'e2e/.auth/user.json';

const EMAIL = process.env.SEED_EMAIL ?? 'demo@tri.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'TriDemo2026!';

setup('authenticate and connect MT5', async ({ page }) => {
  // Earlier runs may have left the demo account's login budget spent. Clearing it is
  // legitimate test setup — it resets the world, it does not weaken the limiter.
  const prisma = new PrismaClient();
  try {
    await prisma.rateLimit.deleteMany({});
  } finally {
    await prisma.$disconnect();
  }

  await page.goto('/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/);

  // English, because the specs that use this state assert English copy. Hebrew is the
  // default and has its own tests.
  //
  // Through Settings, not the header: the one-tap language switch was removed from the frame
  // and now lives on the Settings page beside the other preferences. The switch on the
  // sign-in screen stayed, because there is no Settings to reach before signing in.
  await page.goto('/settings');
  const english = page.getByRole('button', { name: 'English', exact: true });
  if (await english.count()) await english.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // Connecting is a four-step wizard, one field per step — not the single form it used to be.
  // Driving it here rather than seeding the account directly is deliberate: this is the only
  // place the connect flow is exercised end to end, and a stale walkthrough is how the whole
  // suite came to be blocked on a form that no longer exists.
  await page.goto('/settings');
  const connected = page.getByText('#50214437').first();
  if (!(await connected.count())) {
    const next = page.getByRole('button', { name: 'Next' });
    await next.click();
    await page.locator('#login-field').fill('50214437');
    await next.click();
    // A free-text field now, not a list: every broker names its servers its own way, so a
    // closed dropdown could not express a real account.
    await page.locator('#server').fill('MetaQuotes-Live01');
    await next.click();
    await page.locator('#password-field').fill('investor-read-only');
    await page.getByRole('button', { name: 'Connect account' }).click();
  }
  await expect(connected).toBeVisible({ timeout: 60_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
