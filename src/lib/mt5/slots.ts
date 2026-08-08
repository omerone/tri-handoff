/**
 * Which account sits in which slot — asked once, so the screen and the action cannot disagree.
 *
 * The settings page draws two slots, one per purpose, and an account sits in the slot it is
 * *for*. That sounds like it needs no help until an account has no purpose at all: every
 * account connected before the column existed has `purpose = null`, and something has to
 * decide where those are drawn.
 *
 * The card decided one way and the connect action decided another, which is the bug this
 * module exists to make impossible. The card gives an unassigned account the first slot no
 * account claims — the swing slot. The action, filling the *day* slot, asked for
 * `purpose === 'day'`, found nothing, and fell back to `purpose === null` — so it found the
 * same unassigned account and read a submission into an empty slot as a *replacement* of the
 * one next to it. The trader was shown "this will delete the trade book — 92 trades", on the
 * screen whose whole purpose was to add a second account without touching the first, and
 * confirming it did exactly what it said.
 *
 * One function, two callers, no room left for them to differ.
 */

/**
 * In drawing order, and the order matters: an account with no purpose takes the first slot
 * nothing else claims, so `swing` first means an old single-account trader keeps seeing their
 * account where they have always seen it.
 */
export const ACCOUNT_SLOTS = ['swing', 'day'] as const;

export type AccountSlot = (typeof ACCOUNT_SLOTS)[number];

/** Structural, so the client card and the server action can both use it. */
type Slotted = { purpose: AccountSlot | null };

/**
 * The occupant of each slot, in `ACCOUNT_SLOTS` order, `null` where a slot is empty.
 *
 * An account claims the slot matching its purpose. Whatever is left unclaimed is filled, in
 * order, from the accounts that never said — each one used once, so two purposeless accounts
 * occupy two slots rather than the same one twice.
 */
export function accountsBySlot<T extends Slotted>(accounts: readonly T[]): (T | null)[] {
  const unassigned = accounts.filter((account) => account.purpose === null);
  return ACCOUNT_SLOTS.map(
    (slot) => accounts.find((account) => account.purpose === slot) ?? unassigned.shift() ?? null,
  );
}

/** What is currently in one slot — the question the connect action asks before replacing. */
export function occupantOfSlot<T extends Slotted>(
  accounts: readonly T[],
  slot: AccountSlot,
): T | null {
  return accountsBySlot(accounts)[ACCOUNT_SLOTS.indexOf(slot)] ?? null;
}
