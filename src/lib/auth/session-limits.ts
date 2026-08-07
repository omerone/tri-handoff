/**
 * How long a sign-in lasts. Four numbers, and nothing else in this file.
 *
 * They live apart from `cookie.ts` because of who needs them. The cookie module signs and
 * verifies with an HMAC, so it imports `node:crypto` and is Node-only; the session *store*
 * needs the same limits to write its WHERE clause, and the app shell needs them to run the
 * same clock in the browser. Keeping the numbers here means neither of those drags a crypto
 * import into a bundle that cannot have one — which is not a hypothetical: putting
 * `SESSION_ABSOLUTE_TTL_MS` in `cookie.ts` made `@/lib/db` unbuildable through
 * `Reading from "node:crypto" is not handled by plugins`.
 *
 * No imports, no `server-only`. A constant is safe everywhere; what enforces it is not.
 */

/**
 * The idle window: an hour without using the app, and the password is asked for again.
 *
 * It was thirty days. That is a reasonable figure for a mailing list and the wrong one for a
 * book of somebody's trades — a laptop left open in a café or a shared machine at a desk
 * stayed signed in for a month. An hour is the window a person actually works in, and every
 * use pushes it out again, so it only ever ends a session nobody was using.
 *
 * Enforced in the database, which is the only copy that counts. `SessionExpiry` in the app
 * shell runs the same clock in the browser so a forgotten tab says so instead of sitting
 * there looking signed in — but that is a courtesy, not the control. A browser that lies
 * about it gets a redirect on its next request.
 */
export const SESSION_IDLE_TTL_MS = 60 * 60 * 1000;

/**
 * The absolute cap, counted from when the session was created and not extended by anything.
 *
 * An idle window alone can be held open forever: a tab that polls, a machine that never
 * sleeps, a stolen cookie replayed once an hour. Twelve hours is longer than any working day
 * this app is used for and short enough that a token taken today is worthless tomorrow.
 *
 * `sessions.created_at` already existed and is never rewritten, so this needs no migration —
 * `findSession` reads it, and `touchSession` cannot move it.
 */
export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Don't rewrite the expiry on every request — once every five minutes is enough.
 *
 * The write is what makes the window roll, so this is also the accuracy of the hour: a
 * session that stops being used right after a write expires 60 minutes later, one that stops
 * right before it expires in 55. Erring short is the safe direction, and five minutes of it
 * is not a figure anyone will notice.
 *
 * It used to be a day, against a thirty-day window — the same ratio.
 */
export const SESSION_REFRESH_AFTER_MS = 5 * 60 * 1000;

/**
 * How long before the idle window closes the shell says something.
 *
 * A minute: long enough to notice and press a key, short enough that it is not a banner
 * somebody learns to ignore. Purely a display figure — `SessionExpiry` reads it — but it
 * belongs with the rest of them.
 */
export const SESSION_WARN_BEFORE_MS = 60 * 1000;

/**
 * The operator panel, which is a bigger prize than any one client's book.
 *
 * A super-admin session can see and act on every tenant, so it gets the tighter pair: half an
 * hour of inactivity rather than an hour, and the same eight-hour ceiling it always had.
 *
 * It used to be eight hours flat with no rolling refresh at all — meaning an operator who
 * signed in at nine was still signed in at five whether they had touched it since or not,
 * on whatever machine they happened to use. Rolling the idle window is the part that reads
 * as a loosening and is not: the ceiling below is unchanged and is still counted from
 * `created_at`, which nothing rewrites.
 */
export const ADMIN_IDLE_TTL_MS = 30 * 60 * 1000;
export const ADMIN_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
