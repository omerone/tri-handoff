import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { consumeRateLimit } from '@/lib/db';
import { limitKey } from '@/lib/auth/limits';
import { isSupportedCurrency } from '@/lib/money/currency';
import { quotesProvider } from '@/lib/quotes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Symbol lookup for the add-position form.
 *
 * A route handler rather than a server action because the caller is a search box: it fires on
 * every pause in typing, needs to abort the request the moment the next keystroke lands, and
 * has nothing to submit. Server actions are queued and cannot be cancelled, so a fast typist
 * would watch five stale searches resolve in order.
 *
 * Behind the session, and rate limited per user. The upstream reference endpoint is free and
 * unauthenticated, which makes an open proxy of it exactly the kind of thing that gets an IP
 * blocked for everyone.
 */

const MAX_RESULTS = 100;  // Show all matching stocks (increased from initial 8)
const SEARCHES = { limit: 60, windowMs: 60 * 1000 };

export async function GET(request: NextRequest) {
  const session = await requireSession();

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  // Two characters is where a search stops matching half the market. Answering an empty
  // query with an empty list rather than an error keeps the client simple: it can fire on
  // every keystroke and let this decide what is worth asking about.
  if (query.length < 2) return NextResponse.json({ results: [] });

  const verdict = await consumeRateLimit(
    limitKey('symbol-search', session.ctx.userId),
    SEARCHES.limit,
    SEARCHES.windowMs,
  );
  if (!verdict.allowed) {
    return NextResponse.json({ results: [] }, { status: 429 });
  }

  // Asked for extra, because the filter below throws some away (unsupported currencies).
  // Request 300+ to ensure we have enough after filtering.
  const found = await quotesProvider().search(query, Math.max(300, MAX_RESULTS * 3));

  // Only listings in a currency the app can actually hold a position in. `AAPL` alone comes
  // back on exchanges quoting Colombian pesos and South African cents; offering one would
  // create a position whose quotes are in a currency it does not have, and the refresh — which
  // refuses to mark a position to a price in another currency — would silently never update
  // it. Better not to offer it at all than to offer a holding that quietly stops working.
  const results = found.filter((match) => isSupportedCurrency(match.currency)).slice(0, MAX_RESULTS);

  return NextResponse.json({ results });
}
