import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * That signing in leaves a record.
 *
 * `SecurityLogger` and the alerting that reads it were written, wired to a schema, given
 * retention and a failed-login threshold — and never called from the login path. Production
 * showed it plainly: twenty-four sessions in the sessions table, zero rows in `auth_events`.
 * Nothing failed, nothing warned, and the whole detection layer sat there with no input.
 *
 * That is the failure mode this file exists for, and it is not one a unit test finds. Every
 * piece works in isolation; what was missing was the call. So the assertion is made the only
 * way that can catch it: drive the real form in a browser and look in the database afterwards.
 *
 * The rows are read by their `createdAt`, not counted from zero — the suite shares a database
 * with everything else that has signed in during the run.
 */

const EMAIL = process.env.SEED_EMAIL ?? 'demo@tri.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'TriDemo2026!';

// Signed out: this drives the sign-in form itself.
test.use({ storageState: { cookies: [], origins: [] } });

const prisma = new PrismaClient();

/*
 * Before every test, and again at the end.
 *
 * The per-account limiter allows ten sign-ins per fifteen minutes and a successful one clears
 * its own bucket — so what accumulates is failures, and this file is the only place in the
 * suite that fails a sign-in on purpose. Four of them, twice over because two viewports run
 * the same file, was enough to spend the budget and leave the *next* spec's sign-in refused:
 * `auth.setup` reported "too many attempts" and eleven unrelated tests went red.
 *
 * `beforeAll` was not enough, since the cost lands between the tests inside this file as well
 * as after it. Clearing afterwards too is the part that matters to everyone else: a spec that
 * spends a shared budget and leaves it spent has made every spec after it flaky, and the
 * failure surfaces somewhere with no connection to the cause.
 *
 * This resets the world rather than weakening the limiter — the same call `auth.setup.ts`
 * makes, for the same reason.
 */
const clearLoginBudget = () =>
  prisma.rateLimit.deleteMany({ where: { key: { startsWith: 'login' } } });

test.beforeEach(clearLoginBudget);

test.afterAll(async () => {
  await clearLoginBudget();
  await prisma.$disconnect();
});

/** Auth events written since a moment, newest first. */
async function eventsSince(since: Date) {
  return prisma.authEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });
}

test.describe('the auth trail', () => {
  test('records a wrong password against the account it was aimed at', async ({ page }) => {
    const since = new Date();

    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', 'definitely-not-the-password');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible();

    const events = await eventsSince(since);
    const failure = events.find((event) => event.eventType === 'login_failed');
    expect(failure, 'a failed sign-in wrote nothing to auth_events').toBeTruthy();
    expect(failure!.result).toBe('failure');
    // Against the real user id, which is what makes the failed-login threshold count the
    // right thing: an account being ground at, rather than raw volume from anywhere.
    expect(failure!.userId).not.toMatch(/^unknown:/);
    expect(failure!.details).toMatchObject({ failureReason: 'wrong_password' });
  });

  test('records an address that has no account here without naming it', async ({ page }) => {
    const since = new Date();

    await page.goto('/login');
    await page.fill('input[name="email"]', 'nobody-here@example.com');
    await page.fill('input[name="password"]', 'whatever');
    await page.click('button[type="submit"]');
    await expect(page.getByRole('status')).toBeVisible();

    const events = await eventsSince(since);
    const failure = events.find((event) => event.eventType === 'login_failed');
    expect(failure, 'a sign-in against an unknown address wrote nothing').toBeTruthy();
    expect(failure!.details).toMatchObject({ failureReason: 'unknown_account' });

    // Keyed to the tenant, never to the address that was tried. The address is the attacker's
    // input and may well be a real person's; the count is the signal, the guess is not
    // evidence. Asserted here because the tempting version of this row carries the email.
    expect(failure!.userId).toMatch(/^unknown:/);
    const serialised = JSON.stringify(failure);
    expect(serialised, 'the attempted address ended up in the trail').not.toContain(
      'nobody-here@example.com',
    );
  });

  test('records a sign-in and the sign-out that closes it', async ({ page }) => {
    const since = new Date();

    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/);

    const afterLogin = await eventsSince(since);
    const success = afterLogin.find((event) => event.eventType === 'login_success');
    expect(success, 'a successful sign-in wrote nothing to auth_events').toBeTruthy();
    expect(success!.result).toBe('success');

    await page.goto('/settings');
    await page.locator('button[aria-label="התנתקות"], button[aria-label="Sign out"]').click();
    await expect(page).toHaveURL(/\/login$/);

    const afterLogout = await eventsSince(since);
    const logout = afterLogout.find((event) => event.eventType === 'logout');
    // The pair is the point: a sign-in with nothing closing it, from an address that appears
    // once, is the shape a stolen cookie leaves behind.
    expect(logout, 'signing out wrote nothing').toBeTruthy();
    expect(logout!.userId).toBe(success!.userId);
  });

  test('never writes a password or a token into the trail', async ({ page }) => {
    const since = new Date();

    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard$/);

    const serialised = JSON.stringify(await eventsSince(since));
    expect(serialised).not.toContain(PASSWORD);
    // The session cookie's token is the credential itself. It has no business anywhere near a
    // table that exists to be read during an investigation.
    const cookies = await page.context().cookies();
    const session = cookies.find((cookie) => cookie.name === 'tri_session');
    expect(session, 'no session cookie was set').toBeTruthy();
    expect(serialised).not.toContain(session!.value.split('.')[0]!);
  });
});
