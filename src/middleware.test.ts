import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware, TENANT_HOST_HEADER } from './middleware';

/**
 * The middleware decides which tenant every downstream query is scoped to, from a header a
 * client can set. `x-tri-host` is therefore stripped from the incoming request before it is
 * re-set: if a spoofed value ever survived, a request to one client's domain would be
 * served another client's data, and nothing further down the stack would notice — the
 * repositories would be doing exactly what they were told.
 */

function run(headers: Record<string, string>): string | null {
  const response = middleware(
    new NextRequest('http://example.test/dashboard', { headers: new Headers(headers) }),
  );
  // NextResponse.next({ request: { headers } }) carries the overridden request headers on
  // the response, prefixed. Reading it here is the only way to see what the page will get.
  return response.headers.get(`x-middleware-request-${TENANT_HOST_HEADER}`);
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
