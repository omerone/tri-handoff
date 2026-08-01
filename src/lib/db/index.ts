import 'server-only';

/**
 * The single data-access layer.
 *
 * Every read and write in the application goes through the repositories re-exported here.
 * They take a branded `TenantContext` and scope by it; the Prisma client itself is not
 * exported, and ESLint blocks importing it from outside this directory.
 */

export { makeTenantContext } from './context';
export * from './tenants';
export * from './users';
export * from './provisioning';
export * from './sessions';
export * from './reset-tokens';
export * from './rate-limit';
