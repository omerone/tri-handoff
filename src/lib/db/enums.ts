import 'server-only';
import type { Mt5Status, SyncStatus, SyncTrigger, TenantStatus } from '@prisma/client';

/**
 * Database enum types, re-exported so application code never has to name `@prisma/client`.
 *
 * The tenant-isolation lint rule blocks that import outright, including type-only ones. That
 * is deliberate rather than over-strict: exceptions for `import type` are exactly how a value
 * import sneaks back in later, and the domain having no compile-time dependency on the ORM's
 * generated types is worth having on its own.
 */
export type { Mt5Status, SyncStatus, SyncTrigger, TenantStatus };
