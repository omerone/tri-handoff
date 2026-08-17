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
    await prisma.dayNote.deleteMany({ where: { body: { startsWith: PREFIX } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** One day's card, found by the date printed on it. */
function dayCard(page: Page, iso: string) {
  const [year, month, day] = iso.split('-');
  return page.locator('section').filter({ hasText: `${day}/${month}/${year}` }).first();
}

/**
 * Write one down, into the day you are looking at.
 *
 * The field stays open after a save — a run of goals for one day is the ordinary case — so the
 * opener is only pressed when it is actually there.
 */
async function addGoal(page: Page, title: string, day: string) {
  const card = dayCard(page, day);
  const field = card.locator('input[name="title"]');

  // Clicked until the field is actually there. Arriving here right after a navigation — the
  // member switch is a form POST — means the opener's onClick may not be attached yet, and a
  // single click into the pre-hydration DOM is swallowed whole. Evidence, not hope.
  for (let attempt = 0; attempt < 6 && !(await field.isVisible().catch(() => false)); attempt += 1) {
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    try {
      await expect(field).toBeVisible({ timeout: 2_000 });
    } catch {
      // swallowed — go again
    }
  }
  await expect(field).toBeVisible();

  await field.fill(title);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
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


  test('writes into the day that was pressed', async ({ page }) => {
    /*
     * What the client reported. The week is drawn as seven cards, they look like something you
     * can press, and pressing one did nothing: the only way in was a form above them with the
     * day in a dropdown — scroll up, find Wednesday again in a list of seven, having just
     * pointed at it.
     *
     * The day is not a field any more, it is which card you are in, so it cannot be picked
     * wrongly either.
     */
    const title = goal('pressed');
    await page.goto(`/goals?week=${PAST_WEEK}`);

    // Every day offers one, including the empty ones — a day you cannot write to is a day the
    // week is missing.
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(7);

    await addGoal(page, title, '2026-01-07');
    await expect(dayCard(page, '2026-01-07')).toContainText(title);
    await expect(dayCard(page, '2026-01-06')).not.toContainText(title);

    // And it stays open, so a second goal for the same day is one field away rather than four
    // clicks: this is written in runs.
    await expect(dayCard(page, '2026-01-07').locator('input[name="title"]')).toBeVisible();
  });


  test('takes a note on a day without counting it as a goal', async ({ page }) => {
    /*
     * The line this feature had to not cross.
     *
     * The week's figures are counted out of the checklist, so a note carrying a goal's shape
     * would be counted with them — and every day somebody wrote a sentence on would read as a
     * day with something left undone. A tool that quietly marks you down for writing things
     * down is worse than one with no notes at all, which is why the figures are read before
     * and after and have to be identical.
     */
    const note = `${PREFIX} market closed early`;
    await page.goto(`/goals?week=${PAST_WEEK}`);

    const before = {
      kept: await tile(page, 'Kept').innerText(),
      missed: await tile(page, 'Missed').innerText(),
      planned: await tile(page, 'Planned').innerText(),
    };

    const card = dayCard(page, '2026-01-08');
    await card.getByRole('button', { name: 'Note', exact: true }).click();
    await card.locator('textarea[name="body"]').fill(note);
    await card.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(card).toContainText(note);
    expect(await tile(page, 'Kept').innerText()).toBe(before.kept);
    expect(await tile(page, 'Missed').innerText()).toBe(before.missed);
    expect(await tile(page, 'Planned').innerText()).toBe(before.planned);

    // It is still there on the way back, rather than only looking written.
    await page.reload();
    await expect(dayCard(page, '2026-01-08')).toContainText(note);

    // And it belongs to its own day, not to the week.
    await expect(dayCard(page, '2026-01-07')).not.toContainText(note);
  });

  test('removes the note when the field is emptied', async ({ page }) => {
    // The only gesture there is: clearing the field. A second control for the same act is a
    // second thing to find, and an empty note stored as a row is a note to every query that
    // counts them and to nobody reading the screen.
    const note = `${PREFIX} written then withdrawn`;
    await page.goto(`/goals?week=${PAST_WEEK}`);

    const card = dayCard(page, '2026-01-09');
    await card.getByRole('button', { name: 'Note', exact: true }).click();
    await card.locator('textarea[name="body"]').fill(note);
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(card).toContainText(note);

    await card.getByRole('button', { name: 'Note on the day' }).click();
    await card.locator('textarea[name="body"]').fill('');
    await card.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(card).not.toContainText(note);
    await page.reload();
    await expect(dayCard(page, '2026-01-09')).not.toContainText(note);
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

test.describe('whose week it is', () => {
  /**
   * Goals are per-brother, like the money and the hours.
   *
   * The screen reads the header switch and the repository filters on `owner`, but nothing
   * proved the two were joined up — and a filter that quietly stops filtering is invisible
   * until one brother is ticking off the other's week. The switch also has to be *live* here:
   * it is dimmed on the trading screens, so "the control is on the page" is not the same claim.
   */
  const flip = (page: Page, name: string) =>
    page
      .getByRole('group', { name: /whose data|של מי הנתונים/i })
      .getByRole('button', { name, exact: true });

  test('keeps one brother’s goals out of the other’s week', async ({ page }) => {
    const mine = goal('yoni-week');

    await page.goto(`/goals?week=${PAST_WEEK}`);
    await flip(page, 'יוני').click();
    await expect(flip(page, 'יוני')).toHaveAttribute('aria-pressed', 'true');
    await addGoal(page, mine, PAST_WEEK);

    await flip(page, 'אביתר').click();
    await expect(
      page.getByText(mine),
      "יוני's goal is showing in אביתר's week",
    ).toHaveCount(0);

    // And it is still there when the switch comes back — filtered, not lost.
    await flip(page, 'יוני').click();
    await expect(page.getByText(mine)).toBeVisible();
  });

  test('the switch is live here rather than dimmed', async ({ page }) => {
    // Dimmed means "this screen is shared" — which goals are not.
    await page.goto(`/goals?week=${PAST_WEEK}`);
    const group = page.getByRole('group', { name: /whose data|של מי הנתונים/i });
    await expect(page.locator('form[data-tip]').filter({ has: group })).toHaveCount(0);
  });
});
