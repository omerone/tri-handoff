import { NextResponse, type NextRequest } from 'next/server';
import { normalizeDomain } from '@/lib/tenant/domain';

/**
 * Two jobs, both per-request.
 *
 * 1. Strip any client-supplied `x-tri-host` and replace it with the normalised effective
 *    host, so nothing downstream can be fooled by a header the caller set. This is defence
 *    in depth, not the source of truth: a middleware `matcher` is an easy thing to get
 *    subtly wrong — an earlier version excluded paths ending in an image extension, which
 *    meant `/reset/<token>.png` rendered a real page the middleware never ran on, leaving
 *    `x-tri-host` under the caller's control. `getRequestHost()` therefore derives the host
 *    from the proxy headers itself and never reads this one.
 *
 * 2. Mint a CSP nonce. Next inlines its bootstrap and streaming scripts, so a policy without
 *    `script-src` is not "unset" — it falls back to `default-src` and blanks the page. A
 *    per-request nonce is the only way to keep a real script-src without `unsafe-inline`;
 *    Next reads the nonce out of the request's own CSP header and stamps it onto every
 *    script it emits.
 */

export const TENANT_HOST_HEADER = 'x-tri-host';
export const NONCE_HEADER = 'x-nonce';

function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // `strict-dynamic` lets the nonced bootstrap load the chunks it needs without listing
    // each one. Dev additionally needs `unsafe-eval` for React Refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    // Styled with Tailwind, but Next still emits inline <style> for critical CSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  // Caddy sets X-Forwarded-Host; fall back to Host for direct/dev access.
  const forwarded = request.headers.get('x-forwarded-host');
  const host = normalizeDomain(forwarded || request.headers.get('host') || '');

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');

  const headers = new Headers(request.headers);
  headers.delete(TENANT_HOST_HEADER);
  headers.set(TENANT_HOST_HEADER, host);
  headers.set(NONCE_HEADER, nonce);
  // Next looks for the nonce here, on the *request*, to stamp its own inline scripts.
  headers.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // Only Next's own immutable asset routes are excluded. Anything that can render a page or
  // run a server action must pass through here — including paths that happen to end in a
  // file extension, since App Router segments match those too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
