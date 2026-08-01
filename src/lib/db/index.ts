import 'server-only';

/**
 * The tenant-scoped data-access layer — what application code imports.
 *
 * Every function exported here takes a `TenantContext` and scopes its query by it. The
 * Prisma client is not exported, and ESLint blocks importing it from outside this
 * directory.
 *
 * The primitives that cannot take a context (host lookup, login, reset redemption,
 * operator tooling) live in `./unscoped`, which ESLint restricts to the modules that
 * establish identity. Keeping them out of this barrel is the point: a future server action
 * that reaches for `setPasswordHash` has to name the unscoped module to get it.
 */

export { getUser, updateUserPreferences, touchLastLogin } from './users';

// Not tenant data — counters keyed by an opaque string. Safe for any caller.
export * from './rate-limit';

// Maintenance sweep, called from src/instrumentation.ts. Deletes only expired rows.
export { pruneExpiredSessions } from './sessions';
