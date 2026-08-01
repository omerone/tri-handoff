import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { lookupTenantByDomain, type TenantLookup } from '@/lib/db';
import { TENANT_HOST_HEADER } from '@/middleware';
import { normalizeDomain } from './domain';

/**
 * Host-header resolution, step two: the database half.
 *
 * Wrapped in React's `cache`, so a page that asks for the tenant in its layout, its
 * metadata and three server components still costs exactly one query per request.
 */

export const getRequestHost = cache(async (): Promise<string> => {
  const store = await headers();
  // Set by the middleware, which strips any client-supplied value first.
  const fromMiddleware = store.get(TENANT_HOST_HEADER);
  if (fromMiddleware) return fromMiddleware;
  // Direct hits that bypass the matcher (static-ish routes) still resolve sensibly.
  return normalizeDomain(store.get('x-forwarded-host') ?? store.get('host') ?? '');
});

export const resolveTenant = cache(async (): Promise<TenantLookup> => {
  const host = await getRequestHost();
  return lookupTenantByDomain(host);
});
