import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * The login page looks like the product behind it.
 *
 * A domain has exactly one trader, so the signed-out screens have a well-defined look — and
 * for a while they did not use it: only sign-in wrote the style cookie, so an account set to
 * the amber "instrument" look greeted its owner with a blue "depth" login on every fresh
 * device. The root layout now asks the tenant's one user when nobody is signed in.
 */

// A browser that has never seen this account: no session, no cookies.
test.use({ storageState: { cookies: [], origins: [] } });

test('a fresh browser gets the trader\'s look on the login page', async ({ page }) => {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUnique({
    where: { domain: 'demo.localhost' },
    select: { user: { select: { id: true, displayStyle: true } } },
  });
  const before = tenant!.user!.displayStyle;
  await prisma.user.update({
    where: { id: tenant!.user!.id },
    data: { displayStyle: 'instrument' },
  });

  try {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-style', 'instrument');
  } finally {
    await prisma.user.update({
      where: { id: tenant!.user!.id },
      data: { displayStyle: before },
    });
    await prisma.$disconnect();
  }
});
