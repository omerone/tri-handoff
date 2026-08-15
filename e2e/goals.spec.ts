import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * The week's checklist, against the seeded demo tenant.
 *
 * The arithmetic is unit-tested. What cannot be seen from there is whether a tick on screen
 * reaches the database and comes back as a number — the statistic is built entirely out of
 * those ticks, so a box that looks ticked and is not would make every figure beside it wrong
 * while looking perfectly reasonable.
 *
 * Both walks pin a week explicitly. A test that used "this week" would assert different things
 * on a Sunday than on a Friday — the measure deliberately counts only days that have arrived —
 * and would pass or fail by the day it was run on.
 */

const PREFIX = 'E2E';
const goal = (name: string) => `${PREFIX}-${name}-${process.env.TEST_PARALLEL_INDEX ?? '0'}`;

/** Sundays. One long past, one far ahead — neither is a week anything else writes to. */
const PAST_WEEK = '2026-01-04';
const FUTURE_WEEK = '2027-06-06';

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.goal.deleteMany({ where: { title: { startsWith: PREFIX } } });
  } finally {
    await prisma.$disconnect();
  }
});

/**
 * Write one down, on whichever layout is drawing the form.
 *
 * Inline from `md`; on a phone it is behind a button whose handler only exists after
 * hydration, so a click that lands too early is swallowed silently. Clicking until the field
 * is actually visible is the only evidence the handler was attached.
 */
async function addGoal(page: Page, title: string, day: string) {
  const form = page.locator('form:has(select[name="dueOn"])').first();
  const field = form.locator('input[name="title"]');
  const opener = page.getByRole('button', { name: 'Add a goal' }).first();

  for (let attempt = 0; attempt < 6 && !(await field.isVisible().catch(() => false)); attempt += 1) {
    if (await opener.isVisible().catch(() => false)) await opener.click();
    await expect(field)
      .toBeVisible({ timeout: 2_000 })
      .catch(() => undefined);
  }

  await field.fill(title);
  await form.locator('select[name="dueOn"]').selectOption(day);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(title)).toBeVisible();
}

/** A KPI tile, by the label above its figure — the same shape the finance spec pins them by. */
function tile(page: Page, label: string) {
  return page.locator(`div:has(> div:text-is("${label}"))`).first();
}

test.describe('the week’s checklist', () => {
  test('turns ticks into the figures above it', async ({ page }) => {
    const done = goal('done');
    const undone = goal('undone');

    // A week entirely in the past, so every day of it has arrived and the sums are fixed
    // whatever day this runs on.
    await page.goto(`/goals?week=${PAST_WEEK}`);
    await addGoal(page, done, '2026-01-05');
    await addGoal(page, undone, '2026-01-05');

    await expect(tile(page, 'Kept')).toContainText('0 of 2 due so far');
    await expect(tile(page, 'Missed')).toContainText('2');

    await page.getByRole('checkbox', { name: `Mark done: ${done}` }).click();

    await expect(tile(page, 'Kept')).toContainText('50%');
    await expect(tile(page, 'Kept')).toContainText('1 of 2 due so far');
    // The day is gone and one of its goals is not ticked, so it is not a day kept.
    await expect(tile(page, 'Full days')).toContainText('0/1');
    await expect(tile(page, 'Missed')).toContainText('1');

    // And it survives the round trip rather than only looking ticked.
    await page.reload();
    await expect(page.getByRole('checkbox', { name: `Mark done: ${done}` })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: `Mark done: ${undone}` })).not.toBeChecked();
  });

  test('does not score a week against days that have not happened', async ({ page }) => {
    /*
     * The decision the whole measure rests on.
     *
     * A week is written in advance. Counting Thursday's goals as failures on Monday reports a
     * collapse on a day nothing has gone wrong, and the figure would then climb through every
     * week regardless of behaviour — a measure of the day of the week, not of the person.
     *
     * A week that has not started has nothing due, so it gets a dash rather than a zero. Zero
     * is a real answer meaning nothing was kept.
     */
    await page.goto(`/goals?week=${FUTURE_WEEK}`);
    await addGoal(page, goal('ahead'), '2027-06-09');

    await expect(tile(page, 'Kept')).toContainText('—');
    await expect(tile(page, 'Kept')).not.toContainText('0%');
    await expect(tile(page, 'Missed')).toContainText('0');
    // The goal is still counted as planned: that is what the week holds, not what was scored.
    await expect(tile(page, 'Planned')).toContainText('1');
  });

  test('steps between weeks and back to this one', async ({ page }) => {
    await page.goto(`/goals?week=${PAST_WEEK}`);
    await expect(page.getByText('04/01 – 10/01')).toBeVisible();

    await page.getByRole('link', { name: 'Next week' }).click();
    await expect(page.getByText('11/01 – 17/01')).toBeVisible();

    await page.getByRole('link', { name: 'Previous week' }).click();
    await expect(page.getByText('04/01 – 10/01')).toBeVisible();
  });
});
