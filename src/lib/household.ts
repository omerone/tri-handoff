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
 * A repository-level filter: one brother, or null for "no filter".
 *
 * The *screens* never pass null any more — the switch has exactly two positions, because the
 * brothers asked for their money apart, full stop, and a third "both" position was a merged
 * view neither of them wanted. Null stays at this layer for the tests and for any tooling
 * that legitimately reads the whole table.
 */
export type BrotherFilter = Brother | null;

export function isBrother(value: unknown): value is Brother {
  return typeof value === 'string' && (HOUSEHOLD as readonly string[]).includes(value);
}

/** The cookie the header switch keeps its position in. */
export const BROTHER_COOKIE = 'tri-brother';

/**
 * Reads a raw cookie value back into a position, defaulting to the first brother.
 *
 * There is no "both": the switch rests on somebody, always. Tolerant of stale or
 * unrecognisable values on purpose — this survives deployments inside people's browsers, and
 * a renamed brother must degrade to a working screen rather than to an error or to a filter
 * on a person who no longer exists.
 */
export function parseBrother(value: string | undefined): Brother {
  return isBrother(value) ? value : HOUSEHOLD[0];
}
