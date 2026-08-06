import 'server-only';

/**
 * Deliberately unscoped database access.
 *
 * Everything re-exported here operates on a user, a tenant or the whole platform *without*
 * a `TenantContext` — because it runs before one exists (resolving a host, verifying a
 * password, redeeming a reset token) or because it is genuinely cross-tenant (the operator
 * panel). `setPasswordHash(userId, …)` will happily overwrite any user's password; that is
 * exactly why it lives behind a module name that is hard to import by accident.
 *
 * ESLint restricts importing this module to the places that establish identity —
 * `src/lib/auth`, `src/lib/tenant`, `src/app/(auth)` — plus `src/app/admin`. Application
 * code uses `@/lib/db`, whose exports all demand a `TenantContext`.
 */

export { makeTenantContext } from './context';
export * from './tenants';
export * from './provisioning';
export * from './sessions';
export * from './reset-tokens';
export * from './super-admins';
export * from './admin';
export {
  findUserById,
  findUserForLogin,
  findUserByEmailForReset,
  setPasswordHash,
} from './users';
export * from './two-factor';
