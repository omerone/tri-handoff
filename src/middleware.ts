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
  // Content Security Policy: restrictive by default, whitelist only what's needed.
  // This prevents XSS, clickjacking, and data exfiltration attacks.
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
    // Upgrade insecure requests to HTTPS (in production)
    ...(process.env.NODE_ENV === 'production' ? ["upgrade-insecure-requests"] : []),
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

  // Content Security Policy: prevent XSS and clickjacking attacks.
  response.headers.set('content-security-policy', csp);

  // Additional Security Headers

  // X-Content-Type-Options: prevent MIME-type sniffing. Always send as-is.
  response.headers.set('x-content-type-options', 'nosniff');

  // X-Frame-Options: prevent clickjacking by disallowing embedding in iframes.
  // This is redundant with CSP frame-ancestors but provided for older browsers.
  response.headers.set('x-frame-options', 'DENY');

  // X-XSS-Protection: enable XSS filter in older browsers (IE/Edge pre-Chromium).
  // Note: modern browsers use CSP instead, but this is for defense-in-depth.
  response.headers.set('x-xss-protection', '1; mode=block');

  // Referrer-Policy: limit referrer information sent to external sites.
  // "strict-origin-when-cross-origin" balances privacy and analytics utility.
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy (formerly Feature-Policy): disable unused browser features.
  // This prevents JavaScript from accessing sensitive APIs that aren't needed.
  const permissionsPolicy = [
    'accelerometer=()',           // Disable accelerometer access
    'camera=()',                  // Disable camera access
    'geolocation=()',             // Disable geolocation access
    'gyroscope=()',               // Disable gyroscope access
    'magnetometer=()',            // Disable magnetometer access
    'microphone=()',              // Disable microphone access
    'payment=()',                 // Disable Payment Request API
    'usb=()',                     // Disable USB access
    'vr=()',                      // Disable VR device access
  ].join(', ');
  response.headers.set('permissions-policy', permissionsPolicy);

  // Strict-Transport-Security: force HTTPS connections (only in production).
  // max-age=31536000 = 1 year. includeSubDomains extends to subdomains.
  // preload allows inclusion in HSTS preload list (opt-in).
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}

export const config = {
  // Only Next's own immutable asset routes are excluded. Anything that can render a page or
  // run a server action must pass through here — including paths that happen to end in a
  // file extension, since App Router segments match those too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
