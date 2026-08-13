import { describe, expect, it } from 'vitest';
import {
  createLearningEntry,
  findLearningEntry,
  listLearningEntries,
  updateLearningEntry,
} from '@/lib/db';
import { createTenantFixture } from '../helpers/fixtures';

/**
 * The study ledger against a real database.
 *
 * The screen-level rules — who may edit what, and that a correction replaces rather than
 * accumulates — are the kind that a mock cannot tell you the truth about, because the answer
 * lives in the WHERE clause.
 */

describe('rewriting a session', () => {
  /**
   * Editing is the difference between a ledger that stays true and one people stop
   * correcting: before this, fixing a mistyped hour meant deleting the row and typing the
   * note, the topic and the date again.
   */
  it('rewrites in place rather than adding a second row', async () => {
    const fixture = await createTenantFixture();
    const created = await createLearningEntry(fixture.ctx, {
      topic: 'technical',
      title: 'מבנה שוק',
      note: 'ההערה המקורית',
      hours: 2,
      learnedOn: new Date('2026-08-03'),
      learner: 'יוני',
    });

    const ok = await updateLearningEntry(fixture.ctx, created.id, {
      topic: 'psychology',
      title: 'שליטה עצמית',
      note: null,
      hours: 1.5,
      learnedOn: new Date('2026-08-04'),
      learner: 'אביתר',
    });
    expect(ok).toBe(true);

    const rows = await listLearningEntries(fixture.ctx, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      topic: 'psychology',
      title: 'שליטה עצמית',
      hours: 1.5,
      learner: 'אביתר',
    });
    // Every field is written, so a cleared note clears rather than lingering.
    expect(rows[0]?.note).toBeNull();
  });

  it("refuses another tenant's row instead of throwing", async () => {
    // The same shape the finance ledger uses: the scope is inside the statement, so a
    // mistyped or borrowed id matches nothing rather than relying on a check at the call site.
    const mine = await createTenantFixture();
    const theirs = await createTenantFixture();
    const row = await createLearningEntry(mine.ctx, {
      topic: 'technical',
      title: 'שלי',
      note: null,
      hours: 1,
      learnedOn: new Date('2026-08-05'),
      learner: 'יוני',
    });

    const ok = await updateLearningEntry(theirs.ctx, row.id, {
      topic: 'psychology',
      title: 'נחטף',
      note: null,
      hours: 9,
      learnedOn: new Date('2026-08-06'),
      learner: 'אביתר',
    });
    expect(ok).toBe(false);
    expect(await findLearningEntry(theirs.ctx, row.id)).toBeNull();
    expect((await findLearningEntry(mine.ctx, row.id))?.title).toBe('שלי');
  });
});
