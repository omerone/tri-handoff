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
 * tenant boundary must not depend on a regex being exhaustive.
 *
 * `x-forwarded-host` is trustworthy only because the proxy in front overwrites it and the app
 * is not reachable around that proxy. Both halves have to hold, and both had stopped holding:
 * the nginx in production forwarded the client's own header untouched, and the app container
 * was published on 0.0.0.0:3000 beside it. Either one alone lets the caller name their own
 * tenant and claim to have arrived on the operator's hostname. This is the one comment in the
 * file that is a deployment invariant rather than a description of the code, so it is worth
 * re-reading against `docker-compose.yml` and the live proxy config rather than trusting.
 */

export const getRequestHost = cache(async (): Promise<string> => {
  const store = await headers();
  return normalizeDomain(store.get('x-forwarded-host') ?? store.get('host') ?? '');
});

/**
 * The one host alias, and the three things that keep it from being a hole.
 *
 * Typing `localhost:3000` and landing on the seeded demo tenant is a genuine convenience, and
 * this is the right layer for it — `normalizeDomain` is not, because `assertAdminHost` and the
 * unknown-host 404 both parse hosts with that function and an alias there rewrites what they
 * compare (see the comment in `domain.ts`).
 *
 * It is still only safe with all three of these:
 *
 *   1. **Development only.** A previous version had no environment check, so in production any
 *      request carrying `Host: localhost` — an internal health check, a misconfigured proxy, a
 *      request forged against a container that is reachable directly — was served a real
 *      client's book.
 *   2. **An exact match.** It was written as `host.includes('localhost')`, which matches
 *      `localhost.example.com` and `mylocalhost.io` just as happily. Anyone who can point a
 *      hostname at the server picks up the tenant with a substring.
 *   3. **No `vercel.app`.** The same version mapped every `*.vercel.app` host to the demo
 *      tenant, which would put a client's trading book on every preview deployment URL.
 *
 * The tenant boundary is the product's central guarantee; a convenience that costs it is not a
 * convenience. `e2e/smoke.spec.ts` asserts the production behaviour.
 */
const DEV_HOST_ALIAS = 'localhost';
const DEV_ALIAS_TARGET = 'demo.localhost';

export const resolveTenant = cache(async (): Promise<TenantLookup> => {
  const host = await getRequestHost();

  // Development localhost alias
  if (process.env.NODE_ENV !== 'production' && host === DEV_HOST_ALIAS) {
    return lookupTenantByDomain(DEV_ALIAS_TARGET);
  }

  return lookupTenantByDomain(host);
});
