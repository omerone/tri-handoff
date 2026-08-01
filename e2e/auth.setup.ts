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
  const toggle = page.getByRole('button', { name: 'Switch to English' });
  if (await toggle.count()) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.goto('/settings');
  const login = page.locator('input[name="login"]');
  if (await login.count()) {
    await login.fill('50214437');
    await page.fill('input[name="server"]', 'MetaQuotes-Live01');
    await page.fill('input[name="investorPassword"]', 'investor-read-only');
    await page.getByRole('button', { name: /Connect account/ }).click();
  }
  await expect(page.getByText('#50214437')).toBeVisible({ timeout: 60_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
