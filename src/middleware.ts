import { NextResponse, type NextRequest } from 'next/server';
import { normalizeDomain } from '@/lib/tenant/domain';

/**
 * Host-header resolution, step one.
 *
 * The middleware runs on the Edge runtime, where Prisma is not available, so it does the
 * half of tenant resolution that needs no database: work out the *effective* host behind
 * Caddy, normalise it, and hand it downstream on `x-tri-host`. The lookup against the
 * `tenants` table happens in `src/lib/tenant/resolve.ts`, which runs in Node.
 *
 * Splitting it this way also means the host a page sees can only come from here — the
 * header is stripped from the incoming request first, so a client cannot spoof
 * `x-tri-host` and be served another tenant's environment.
 */

export const TENANT_HOST_HEADER = 'x-tri-host';

export function middleware(request: NextRequest) {
  // Caddy sets X-Forwarded-Host; fall back to Host for direct/dev access.
  const forwarded = request.headers.get('x-forwarded-host');
  const host = normalizeDomain(forwarded || request.headers.get('host') || '');

  const headers = new Headers(request.headers);
  headers.delete(TENANT_HOST_HEADER);
  headers.set(TENANT_HOST_HEADER, host);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except static assets. /healthz and /api/tls/allow deliberately stay in scope
  // but are host-agnostic, so passing the header through costs nothing.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
