import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe for Docker/Caddy and the Playwright web server. Never tenant-scoped. */
export function GET() {
  return NextResponse.json({ ok: true });
}
