/**
 * The two people behind the one login.
 *
 * The client is a pair of brothers. Trading — the accounts, the trades, the long-term
 * positions — is genuinely joint, which is why the product stays one tenant with one login:
 * splitting the account would split the book, the 2FA and the broker sync along with it, all
 * of which are shared on purpose. What is *not* joint is money and study: each brother has his
 * own income, his own expenses and his own hours, and a ledger that merges them answers a
 * question neither of them asked.
 *
 * So "whose" is a property of a row, not of a login, and this is the list of possible answers.
 * A constant rather than a table because two fixed names are configuration, not data — there
 * is no screen for editing them, and a typo'd third brother appearing in a dropdown is exactly
 * what a free-text field allowed and this closes off.
 *
 * The names are Hebrew because they are names, not labels: they render identically in both
 * locales, the way a name on an envelope does. Nothing translates them.
 */
export const HOUSEHOLD = ['יוני', 'אביתר'] as const;

export type Brother = (typeof HOUSEHOLD)[number];

/**
 * The switch's three positions: one brother, the other, or the household as a whole.
 *
 * `null` is "both" — deliberately not a third name in the list, because "both" is the absence
 * of a filter rather than a person, and code that treats it as a person ends up writing rows
 * owned by nobody-in-particular when the switch happens to rest there.
 */
export type BrotherFilter = Brother | null;

export function isBrother(value: unknown): value is Brother {
  return typeof value === 'string' && (HOUSEHOLD as readonly string[]).includes(value);
}

/** The cookie the header switch keeps its position in. */
export const BROTHER_COOKIE = 'tri-brother';

/**
 * Reads a raw cookie value back into a filter, treating anything unrecognised as "both".
 *
 * Tolerant on purpose: this value survives deployments in people's browsers, and a renamed
 * brother or a stale value must degrade to showing everything rather than to an error — or
 * worse, to silently filtering by a person who no longer exists.
 */
export function parseBrother(value: string | undefined): BrotherFilter {
  return isBrother(value) ? value : null;
}
