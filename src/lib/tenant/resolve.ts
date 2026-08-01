import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { lookupTenantByDomain, type TenantLookup } from '@/lib/db/unscoped';
import { normalizeDomain } from './domain';

/**
 * Host → tenant, request-cached: a page that asks for the tenant in its layout, its metadata
 * and three server components still costs exactly one query.
 *
 * The host is derived here from the proxy headers rather than read from the `x-tri-host`
 * that the middleware sets. The middleware still strips and rewrites that header, but a
 * matcher gap would leave it under the caller's control on the affected route, and the
 * tenant boundary must not depend on a regex being exhaustive. `x-forwarded-host` is
 * trustworthy for the opposite reason: Caddy overwrites it, and the app container is only
 * `expose`d, never published, so nothing else can reach it.
 */

export const getRequestHost = cache(async (): Promise<string> => {
  const store = await headers();
  return normalizeDomain(store.get('x-forwarded-host') ?? store.get('host') ?? '');
});

export const resolveTenant = cache(async (): Promise<TenantLookup> => {
  const host = await getRequestHost();
  return lookupTenantByDomain(host);
});
