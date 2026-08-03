import 'server-only';
import { prisma } from './prisma';

/**
 * Consent rows (GDPR processing, marketing, cookies, terms).
 *
 * Exposed from the database layer rather than reached for directly, for two reasons that have
 * nothing to do with satisfying a lint rule:
 *
 *  - `src/lib/compliance/consent-manager.ts` was constructing its own `new PrismaClient()`.
 *    That is a second connection pool for one table, and — since the shared client is the one
 *    carrying `auditExtension` — every consent grant and revocation was being written without
 *    an audit row. For a table whose entire purpose is proving what a user agreed to, that is
 *    the wrong half of the system to leave untraced.
 *  - Consents are keyed by user, not by tenant, so they are outside the `TenantContext` the
 *    repositories in this directory take. This is the honest place to say so once.
 *
 * The delegate is exported rather than a function per query: the consent manager composes its
 * own `where`/`orderBy`/`distinct` per call, and wrapping seven bespoke queries in seven
 * pass-through functions would duplicate that shape without checking anything.
 */
export const userConsents = prisma.userConsent;
