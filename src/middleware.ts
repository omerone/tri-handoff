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

function contentSecurityPolicy(nonce: string, isDev: boolean, isHttps: boolean): string {
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
    // Upgrade insecure requests to HTTPS — but only when this response is itself being
    // served over HTTPS. Keyed off NODE_ENV it broke every HTTP deployment: the browser
    // rewrote the CSS, JS and form posts of an http:// page to https://, nothing was
    // listening on 443, and the page rendered as unstyled text with a dead login button.
    // A deployment that is deliberately plain HTTP has nothing to upgrade to.
    ...(isHttps ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * The scheme this response is actually going out over. Behind Caddy or nginx the socket is
 * plain HTTP either way, so the proxy's `x-forwarded-proto` is the only honest signal;
 * `nextUrl.protocol` covers direct access with no proxy in front.
 */
function isHttpsRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  return (forwardedProto ?? request.nextUrl.protocol.replace(':', '')) === 'https';
}

export function middleware(request: NextRequest) {
  // Caddy sets X-Forwarded-Host; fall back to Host for direct/dev access.
  const forwarded = request.headers.get('x-forwarded-host');
  const host = normalizeDomain(forwarded || request.headers.get('host') || '');

  const nonce = btoa(crypto.randomUUID());
  const isHttps = isHttpsRequest(request);
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development', isHttps);

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

  /*
   * X-XSS-Protection: 0, which is not the same as leaving it out and is not a downgrade.
   *
   * It was `1; mode=block`, described here as defence in depth. It is the opposite. The header
   * turns on a heuristic auditor that Chrome and Edge have since removed and Firefox never
   * shipped, and that auditor was itself an attack surface: it could be steered — with a
   * crafted URL — into blocking scripts it decided were reflected, which turned a page with no
   * XSS into a way to disable defences selectively, and in `mode=block` into a way to leak
   * cross-origin information a bit at a time. OWASP's guidance is now `0` for exactly that.
   *
   * `0` rather than omitting the header, because the browsers that still have the filter
   * default to having it on. The only way to switch it off is to say so.
   *
   * What actually stops injected script here is the policy above, and it was verified against
   * production rather than assumed: an inline event handler is refused and a cross-origin
   * script does not load. A first probe appeared to show injected script running, which was an
   * artefact of driving the page over the debugger protocol — `strict-dynamic` trusts what
   * trusted script inserts, and code evaluated through CDP is outside the policy entirely.
   */
  response.headers.set('x-xss-protection', '0');

  // Referrer-Policy: limit referrer information sent to external sites.
  // "strict-origin-when-cross-origin" balances privacy and analytics utility.
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy (formerly Feature-Policy): disable unused browser features.
  // This prevents JavaScript from accessing sensitive APIs that aren't needed.
  const permissionsPolicy = [
    'accelerometer=()', // Disable accelerometer access
    'camera=()', // Disable camera access
    'geolocation=()', // Disable geolocation access
    'gyroscope=()', // Disable gyroscope access
    'magnetometer=()', // Disable magnetometer access
    'microphone=()', // Disable microphone access
    'payment=()', // Disable Payment Request API
    'usb=()', // Disable USB access
    'vr=()', // Disable VR device access
  ].join(', ');
  response.headers.set('permissions-policy', permissionsPolicy);

  // Strict-Transport-Security: force HTTPS connections. Only meaningful — and per RFC 6797
  // only permitted — on a response already delivered over HTTPS; a browser must ignore it
  // on a plain-HTTP page, and sending it there risks pinning a host to a scheme it does
  // not serve for the full max-age.
  // max-age=31536000 = 1 year. includeSubDomains extends to subdomains.
  // preload allows inclusion in HSTS preload list (opt-in).
  if (isHttps) {
    response.headers.set(
      'strict-transport-security',
      'max-age=31536000; includeSubDomains; preload',
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
