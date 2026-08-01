import { NextResponse, type NextRequest } from 'next/server';
import { isProvisionedDomain } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Caddy's on-demand TLS `ask` endpoint.
 *
 * Caddy calls this before issuing a certificate for a host it hasn't seen. Answering 200
 * only for domains that belong to an active tenant is what stops anyone who points a DNS
 * record at the server from making us request certificates on their behalf.
 *
 * Reachable only from the Caddy container on the internal network — it is never exposed
 * through the proxy itself.
 */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain');
  if (!domain) return new NextResponse('missing domain', { status: 400 });

  const allowed = await isProvisionedDomain(domain);
  return allowed
    ? new NextResponse('ok', { status: 200 })
    : new NextResponse('unknown domain', { status: 404 });
}
