import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware, NONCE_HEADER, TENANT_HOST_HEADER } from './middleware';

/**
 * The middleware decides which tenant every downstream query is scoped to, from a header a
 * client can set. `x-tri-host` is therefore stripped from the incoming request before it is
 * re-set: if a spoofed value ever survived, a request to one client's domain would be
 * served another client's data, and nothing further down the stack would notice — the
 * repositories would be doing exactly what they were told.
 */

function respond(headers: Record<string, string> = {}): NextResponse {
  return middleware(
    new NextRequest('http://example.test/dashboard', { headers: new Headers(headers) }),
  );
}

function run(headers: Record<string, string>): string | null {
  // NextResponse.next({ request: { headers } }) carries the overridden request headers on
  // the response, prefixed. Reading it here is the only way to see what the page will get.
  return respond(headers).headers.get(`x-middleware-request-${TENANT_HOST_HEADER}`);
}

describe('tenant host header', () => {
  it('is derived from the Host header', () => {
    expect(run({ host: 'Demo.TRi.App:3000' })).toBe('demo.tri.app');
  });

  it('prefers the forwarded host, which is what Caddy sets', () => {
    expect(run({ host: 'app-internal:3000', 'x-forwarded-host': 'demo.tri.app' })).toBe(
      'demo.tri.app',
    );
  });

  it('ignores a client-supplied value', () => {
    expect(run({ host: 'attacker.tri.app', [TENANT_HOST_HEADER]: 'victim.tri.app' })).toBe(
      'attacker.tri.app',
    );
  });

  it('is set to the empty string rather than left absent when there is no host', () => {
    // An absent header would fall through to resolveTenant's own header reading; an empty
    // one resolves to an unknown tenant, which is a 404.
    expect(run({})).toBe('');
  });
});

/**
 * These exist because the first attempt at a CSP shipped `default-src 'self'` with no
 * `script-src`, on the assumption that an unset directive is simply not enforced. It is not:
 * `script-src` falls back to `default-src`, which blocked every one of Next's inline
 * bootstrap scripts and served a blank page on every route. A policy that breaks the app is
 * worse than no policy, so the shape is asserted rather than trusted.
 */
describe('content security policy', () => {
  const cspOf = (response: NextResponse) => response.headers.get('content-security-policy') ?? '';

  it('sets an explicit script-src carrying a nonce', () => {
    const csp = cspOf(respond());
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/);
    expect(csp).toContain("'strict-dynamic'");
  });

  it('never allows unsafe-inline scripts', () => {
    const scriptSrc = cspOf(respond())
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('exposes the same nonce to the page so Next can stamp its scripts', () => {
    const response = respond();
    const nonce = response.headers.get(`x-middleware-request-${NONCE_HEADER}`);
    expect(nonce).toBeTruthy();
    expect(cspOf(response)).toContain(`'nonce-${nonce}'`);
    // Next reads the nonce out of the request's own CSP header, so it has to be there too.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it('mints a fresh nonce per request', () => {
    expect(cspOf(respond())).not.toBe(cspOf(respond()));
  });

  it('keeps the directives that cost nothing', () => {
    const csp = cspOf(respond());
    for (const directive of [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
  });
});

describe('security headers', () => {
  const getHeader = (response: NextResponse, name: string) => response.headers.get(name);

  it('sets X-Content-Type-Options to nosniff', () => {
    const response = respond();
    expect(getHeader(response, 'x-content-type-options')).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', () => {
    const response = respond();
    expect(getHeader(response, 'x-frame-options')).toBe('DENY');
  });

  /**
   * `0`, and the assertion is that it is *not* `1; mode=block` as much as that it is `0`.
   *
   * The header switches on a heuristic auditor that Chrome and Edge have removed and Firefox
   * never had, and that auditor could be steered by a crafted URL into blocking scripts it
   * decided were reflected — turning a page with no XSS into a way to disable defences
   * selectively, and in `mode=block` into a cross-origin information leak. OWASP's guidance is
   * `0`. Omitting the header is not the same thing: browsers that still carry the filter
   * default to it being on, so switching it off has to be said.
   */
  it('switches the legacy XSS auditor off rather than on', () => {
    const response = respond();
    expect(getHeader(response, 'x-xss-protection')).toBe('0');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const response = respond();
    expect(getHeader(response, 'referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets restrictive Permissions-Policy', () => {
    const response = respond();
    const policy = getHeader(response, 'permissions-policy');
    expect(policy).toBeDefined();
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  it('does not set HSTS in development', () => {
    const response = respond();
    // In dev, NODE_ENV is 'development', so HSTS should not be set
    if (process.env.NODE_ENV !== 'production') {
      expect(getHeader(response, 'strict-transport-security')).toBeNull();
    }
  });
});
