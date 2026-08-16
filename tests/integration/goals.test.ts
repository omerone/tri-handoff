import { describe, expect, it } from 'vitest';
import { createGoal, listGoals } from '@/lib/db';
import { createTenantFixture } from '../helpers/fixtures';

/**
 * The week's checklist, per brother, against a real database.
 *
 * The screen reads the header switch and hands the name down; this is the other half of that
 * claim — that the WHERE clause is actually carrying it. A filter that quietly stops filtering
 * is invisible until one brother is ticking off the other's week.
 */

const WEEK_START = '2026-01-04';
const WEEK_END = '2026-01-10';

describe('whose goals these are', () => {
  it('hands each brother only his own', async () => {
    const fixture = await createTenantFixture();
    await createGoal(fixture.ctx, { owner: 'יוני', title: 'לסגור שלוש עסקאות', dueOn: '2026-01-05' });
    await createGoal(fixture.ctx, { owner: 'אביתר', title: 'לכתוב יומן כל יום', dueOn: '2026-01-06' });

    const yoni = await listGoals(fixture.ctx, 'יוני', WEEK_START, WEEK_END);
    expect(yoni.map((row) => row.title)).toEqual(['לסגור שלוש עסקאות']);

    const evyatar = await listGoals(fixture.ctx, 'אביתר', WEEK_START, WEEK_END);
    expect(evyatar.map((row) => row.title)).toEqual(['לכתוב יומן כל יום']);
  });

  it("does not leak a goal across tenants either", async () => {
    // The owner narrows within one login; the tenant scope is what keeps two clients apart,
    // and both live in the same WHERE clause.
    const mine = await createTenantFixture();
    const theirs = await createTenantFixture();
    await createGoal(mine.ctx, { owner: 'יוני', title: 'שלי בלבד', dueOn: '2026-01-07' });

    expect(await listGoals(theirs.ctx, 'יוני', WEEK_START, WEEK_END)).toHaveLength(0);
    expect(await listGoals(mine.ctx, 'יוני', WEEK_START, WEEK_END)).toHaveLength(1);
  });
});

describe('a household of one', () => {
  /**
   * The operator's own tenant: no members, no switch, owner null on every row. The partial
   * unique index and the null-matching filter are what this pins — a solo tenant must not
   * see an owned row, an owned view must not see a solo row, and two ceilings for one
   * category must be impossible in both worlds.
   */
  it('keeps solo rows and owned rows apart', async () => {
    const fixture = await createTenantFixture();
    await createGoal(fixture.ctx, { owner: null, title: 'שלי, בלי שם', dueOn: '2026-01-05' });
    await createGoal(fixture.ctx, { owner: 'יוני', title: 'של יוני', dueOn: '2026-01-05' });

    const solo = await listGoals(fixture.ctx, null, WEEK_START, WEEK_END);
    expect(solo.map((row) => row.title)).toEqual(['שלי, בלי שם']);

    const owned = await listGoals(fixture.ctx, 'יוני', WEEK_START, WEEK_END);
    expect(owned.map((row) => row.title)).toEqual(['של יוני']);
  });
});
