import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  correctFinanceEntry,
  createFinanceEntry,
  deleteFinanceEntry,
  endRecurringSeries,
  listFinanceEntries,
} from '@/lib/db';
import { monthBalance } from '@/lib/finance/balance';
import { cleanup, createTenantFixture, crossTenantContext, type Fixture } from '../helpers/fixtures';

/**
 * Finance is per-user money. The isolation tests here matter as much as the trading ones —
 * arguably more, since a salary is more personally identifying than a trade.
 */

const day = (year: number, month: number, d: number) => new Date(Date.UTC(year, month - 1, d));

let alice: Fixture;
let bob: Fixture;

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('round trip', () => {
  it('stores and reads back an entry', async () => {
    const created = await createFinanceEntry(alice.ctx, {
      type: 'income',
      owner: null,
      category: 'salary',
      label: 'July salary',
      amountIls: 18_500,
      entryDate: day(2026, 7, 1),
      isRecurring: false,
    });

    const entries = await listFinanceEntries(alice.ctx);
    const found = entries.find((entry) => entry.id === created.id);

    expect(found).toMatchObject({
      type: 'income',
      owner: null,
      category: 'salary',
      label: 'July salary',
      amountIls: 18_500,
      isRecurring: false,
      recurringUntil: null,
    });
    // Decimal in the database, number at the boundary.
    expect(typeof found!.amountIls).toBe('number');
  });

  it('keeps the date on the day it was given, with no timezone drift', async () => {
    // A @db.Date column and a UTC-midnight date: the first of the month must not come back
    // as the last day of the previous one.
    const created = await createFinanceEntry(alice.ctx, {
      type: 'expense',
      owner: null,
      category: 'rent',
      label: 'Rent',
      amountIls: 6_200,
      entryDate: day(2026, 3, 1),
      isRecurring: false,
    });

    const found = (await listFinanceEntries(alice.ctx)).find((e) => e.id === created.id)!;
    expect(found.entryDate.getUTCFullYear()).toBe(2026);
    expect(found.entryDate.getUTCMonth() + 1).toBe(3);
    expect(found.entryDate.getUTCDate()).toBe(1);
  });

  it('stores fractional amounts exactly', async () => {
    const created = await createFinanceEntry(alice.ctx, {
      type: 'expense',
      owner: null,
      category: 'food',
      label: 'Coffee',
      amountIls: 17.35,
      entryDate: day(2026, 7, 4),
      isRecurring: false,
    });
    const found = (await listFinanceEntries(alice.ctx)).find((e) => e.id === created.id)!;
    expect(found.amountIls).toBe(17.35);
  });
});

describe('recurring series', () => {
  it('ends at the given month instead of disappearing from history', async () => {
    const salary = await createFinanceEntry(bob.ctx, {
      type: 'income',
      owner: null,
      category: 'salary',
      label: 'Salary',
      amountIls: 12_000,
      entryDate: day(2026, 1, 1),
      isRecurring: true,
    });

    expect(await endRecurringSeries(bob.ctx, salary.id, { year: 2026, month: 6 })).toBe(true);

    const entries = await listFinanceEntries(bob.ctx);
    // Still counted in June and every month before it…
    expect(monthBalance(entries, 2026, 6).income).toBe(12_000);
    expect(monthBalance(entries, 2026, 1).income).toBe(12_000);
    // …and gone from July onwards.
    expect(monthBalance(entries, 2026, 7).income).toBe(0);
  });

  it("will not end another tenant's series", async () => {
    const salary = await createFinanceEntry(alice.ctx, {
      type: 'income',
      owner: null,
      category: 'salary',
      label: 'Salary',
      amountIls: 9_000,
      entryDate: day(2026, 1, 1),
      isRecurring: true,
    });

    expect(await endRecurringSeries(crossTenantContext(bob, alice), salary.id, { year: 2026, month: 2 })).toBe(
      false,
    );

    const entries = await listFinanceEntries(alice.ctx);
    expect(entries.find((e) => e.id === salary.id)!.recurringUntil).toBeNull();
  });
});

describe('tenant isolation', () => {
  it("lists only the caller's own entries", async () => {
    const aliceEntries = await listFinanceEntries(alice.ctx);
    const bobEntries = await listFinanceEntries(bob.ctx);

    const aliceIds = new Set(aliceEntries.map((e) => e.id));
    expect(bobEntries.some((entry) => aliceIds.has(entry.id))).toBe(false);
  });

  it('returns nothing through a forged context', async () => {
    expect(await listFinanceEntries(crossTenantContext(bob, alice))).toEqual([]);
  });

  it("will not update another tenant's entry", async () => {
    const target = (await listFinanceEntries(alice.ctx))[0]!;

    const updated = await correctFinanceEntry(crossTenantContext(bob, alice), target.id, {
      type: 'expense',
      category: 'other',
      label: 'hijacked',
      amountIls: 1,
      entryDate: day(2026, 1, 1),
    });

    expect(updated).toBe(false);
    const after = (await listFinanceEntries(alice.ctx)).find((e) => e.id === target.id)!;
    expect(after.label).toBe(target.label);
    expect(after.amountIls).toBe(target.amountIls);
  });

  it("will not delete another tenant's entry", async () => {
    const target = (await listFinanceEntries(alice.ctx))[0]!;
    expect(await deleteFinanceEntry(crossTenantContext(bob, alice), target.id)).toBe(false);
    expect((await listFinanceEntries(alice.ctx)).some((e) => e.id === target.id)).toBe(true);
  });

  it("does delete the caller's own entry", async () => {
    const target = (await listFinanceEntries(alice.ctx))[0]!;
    expect(await deleteFinanceEntry(alice.ctx, target.id)).toBe(true);
    expect((await listFinanceEntries(alice.ctx)).some((e) => e.id === target.id)).toBe(false);
  });
});

describe("whose money", () => {
  /**
   * One login, two brothers, one budget table. Trading is joint and stays unfiltered; money
   * is not, and the owner column is what keeps one brother's rent out of the other's month.
   */
  it("narrows to one brother, and 'both' holds everything", async () => {
    const fixture = await createTenantFixture();
    await createFinanceEntry(fixture.ctx, {
      type: 'income',
      owner: 'יוני',
      category: 'salary',
      label: 'משכורת יוני',
      amountIls: 10_000,
      entryDate: new Date('2026-08-01'),
      isRecurring: false,
    });
    await createFinanceEntry(fixture.ctx, {
      type: 'expense',
      owner: 'אביתר',
      category: 'rent',
      label: 'שכירות אביתר',
      amountIls: 4_000,
      entryDate: new Date('2026-08-02'),
      isRecurring: false,
    });
    await createFinanceEntry(fixture.ctx, {
      type: 'expense',
      owner: null,
      category: 'other',
      label: 'הוצאה משותפת',
      amountIls: 300,
      entryDate: new Date('2026-08-03'),
      isRecurring: false,
    });

    const mine = await listFinanceEntries(fixture.ctx, 'יוני');
    expect(mine.map((entry) => entry.label)).toEqual(['משכורת יוני']);

    const his = await listFinanceEntries(fixture.ctx, 'אביתר');
    expect(his.map((entry) => entry.label)).toEqual(['שכירות אביתר']);

    // "Both" is the absence of a filter: his, mine, and the row that belongs to the household.
    const everyone = await listFinanceEntries(fixture.ctx, null);
    expect(everyone).toHaveLength(3);
  });

  it('an unowned row appears only in the household view', async () => {
    // Null is "shared", not "unclaimed": handing it to whichever brother happens to be
    // selected would make the same shekel count in two private budgets.
    const fixture = await createTenantFixture();
    await createFinanceEntry(fixture.ctx, {
      type: 'expense',
      owner: null,
      category: 'other',
      label: 'ארנונה',
      amountIls: 900,
      entryDate: new Date('2026-08-05'),
      isRecurring: false,
    });

    expect(await listFinanceEntries(fixture.ctx, 'יוני')).toHaveLength(0);
    expect(await listFinanceEntries(fixture.ctx, 'אביתר')).toHaveLength(0);
    expect(await listFinanceEntries(fixture.ctx, null)).toHaveLength(1);
  });
});

describe('what the actions refuse', () => {
  /**
   * The screens filter on exactly two names, so a row owned by anyone else is invisible in
   * every view — unfindable, uncorrectable, and still counted in nothing. Both ledgers refuse
   * such a row at the door; this pins the rule so neither action can quietly loosen again.
   * (The learning action briefly did: it accepted any string while the finance one refused.)
   */
  it('finance keeps rows out of non-brother hands at the repository level too', async () => {
    const fixture = await createTenantFixture();
    await createFinanceEntry(fixture.ctx, {
      type: 'expense',
      owner: 'יוני',
      category: 'other',
      label: 'בדיקת בעלות',
      amountIls: 10,
      entryDate: new Date('2026-08-06'),
      isRecurring: false,
    });

    // A brother sees his own; a name outside the household sees nothing rather than leaking
    // the whole table the way an ignored filter would.
    expect(await listFinanceEntries(fixture.ctx, 'יוני')).toHaveLength(1);
    expect(await listFinanceEntries(fixture.ctx, 'מישהו אחר')).toHaveLength(0);
  });
});

describe('correcting an entry', () => {
  it('changes what the row says', async () => {
    const before = await createFinanceEntry(alice.ctx, {
      type: 'expense',
      owner: null,
      category: 'food',
      label: 'Resturant',
      amountIls: 14,
      entryDate: day(2026, 3, 4),
      isRecurring: false,
    });

    expect(
      await correctFinanceEntry(alice.ctx, before.id, {
        type: 'expense',
        category: 'leisure',
        label: 'Restaurant',
        amountIls: 141,
        entryDate: day(2026, 3, 5),
      }),
    ).toBe(true);

    const after = (await listFinanceEntries(alice.ctx)).find((one) => one.id === before.id)!;
    expect(after).toMatchObject({ label: 'Restaurant', category: 'leisure', amountIls: 141 });
    expect(after.entryDate.toISOString()).toBe(day(2026, 3, 5).toISOString());
  });

  /*
   * The one this is narrow for.
   *
   * The general update this replaced wrote `recurringUntil: input.recurringUntil ?? null`, so
   * an action that did not carry the field forward re-opened a series its owner had ended —
   * silently, and retroactively, for every month after the end date. A correction has no way
   * to name either recurring column, which is what makes it safe rather than careful.
   */
  it('leaves an ended series ended, and a rule a rule', async () => {
    const salary = await createFinanceEntry(alice.ctx, {
      type: 'income',
      owner: null,
      category: 'salary',
      label: 'Salary',
      amountIls: 9_000,
      entryDate: day(2026, 1, 10),
      isRecurring: true,
    });
    await endRecurringSeries(alice.ctx, salary.id, { year: 2026, month: 6 });
    const ended = (await listFinanceEntries(alice.ctx)).find((one) => one.id === salary.id)!;
    expect(ended.recurringUntil).not.toBeNull();

    await correctFinanceEntry(alice.ctx, salary.id, {
      type: 'income',
      category: 'salary',
      label: 'Salary',
      amountIls: 9_500,
    });

    const after = (await listFinanceEntries(alice.ctx)).find((one) => one.id === salary.id)!;
    expect(after.amountIls).toBe(9_500);
    expect(after.isRecurring).toBe(true);
    expect(after.recurringUntil?.toISOString()).toBe(ended.recurringUntil!.toISOString());
  });

  it('leaves the anchor date alone when none is given', async () => {
    // The editor omits the date on a recurring row: it is opened from whichever occurrence was
    // on screen, and writing that back would shift every other month by the difference.
    const rent = await createFinanceEntry(alice.ctx, {
      type: 'expense',
      owner: null,
      category: 'rent',
      label: 'Rent',
      amountIls: 4_000,
      entryDate: day(2026, 2, 1),
      isRecurring: true,
    });

    await correctFinanceEntry(alice.ctx, rent.id, {
      type: 'expense',
      category: 'rent',
      label: 'Rent',
      amountIls: 4_200,
    });

    const after = (await listFinanceEntries(alice.ctx)).find((one) => one.id === rent.id)!;
    expect(after.entryDate.toISOString()).toBe(day(2026, 2, 1).toISOString());
  });
});
