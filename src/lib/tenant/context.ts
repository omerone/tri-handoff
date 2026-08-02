import type { Locale } from '@/i18n/config';

/**
 * The scoping key every repository demands.
 *
 * `TenantContext` carries a brand that only `src/lib/db` sets, so a caller cannot assemble
 * one out of a user id that arrived in a request. The only way to obtain one is
 * `requireTenantContext()`, which builds it from a verified session on a resolved tenant —
 * which is what makes "scoped by tenant_id through a single data-access layer" true rather
 * than aspirational.
 */
declare const tenantContextBrand: unique symbol;

export type TenantContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly [tenantContextBrand]: true;
};

/** A tenant resolved from the request host, before any user is authenticated. */
export type ActiveTenant = {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
};

/** The signed-in user of the active tenant. */
export type TenantUser = {
  readonly id: string;
  readonly email: string;
  readonly locale: Locale;
  readonly displayCurrency: string;
  readonly theme: 'dark' | 'light' | 'system';
  /** Drives "sync on every login" — see components/shell/sync-status.tsx. */
  readonly lastLoginAt: Date | null;
};

export type TenantSession = {
  readonly tenant: ActiveTenant;
  readonly user: TenantUser;
  readonly ctx: TenantContext;
};
