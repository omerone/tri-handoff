/**
 * Who shares a login.
 *
 * This began as a constant — two brothers, named in code — because the client the product was
 * built for is a pair whose trading is joint and whose money is not. Then the operator
 * onboarded a tenant of their own, and the constant did what constants do: it made the
 * brothers every tenant's household, splitting a single person's budget between two names
 * that are not theirs.
 *
 * So the names live on the tenant row now, and this module keeps only the vocabulary. An
 * empty household is one person: no switch in the header, no owner written on new rows, no
 * filter on any screen. Two or more names get the switch and the per-member split exactly as
 * the brothers had it.
 *
 * Names are stored as written — they are names, and nothing translates them.
 */

/** A member of the household, or null where "nobody in particular" is a legal answer. */
export type MemberFilter = string | null;

export function isMember(household: readonly string[], value: unknown): value is string {
  return typeof value === 'string' && household.includes(value);
}

/** The cookie the header switch keeps its position in. */
export const MEMBER_COOKIE = 'tri-brother';

/**
 * Reads the raw cookie back into a position for this household.
 *
 * A single-person household has no positions, so the answer is null — the caller filters
 * nothing and writes no owner. With members, an absent or unrecognisable value falls back to
 * the first: the value survives deployments inside people's browsers, and a renamed member
 * must degrade to a working screen rather than to a filter on somebody who no longer exists.
 */
export function resolveMember(
  household: readonly string[],
  value: string | undefined,
): MemberFilter {
  if (household.length === 0) return null;
  return isMember(household, value) ? value : (household[0] ?? null);
}
