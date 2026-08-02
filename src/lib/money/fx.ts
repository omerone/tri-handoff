import 'server-only';
import { cache } from 'react';
import { readNewestRate, readRecentRate, writeCachedRate } from '@/lib/db/fx';
import { env } from '@/lib/env';

/**
 * Exchange rates, fetched daily and cached (SPEC §3.1: "עדכון יומי מספיק").
 *
 * The rule for how hard to try, in order:
 *   1. same currency — no rate needed, and no request;
 *   2. a rate published within the last few days — the common case once anyone has loaded
 *      a page today, and the rung that absorbs weekends and holidays, when the feeds publish
 *      nothing and an exact-date lookup would miss on every single request;
 *   3. fetch it, store it;
 *   4. anything cached, however old.
 *
 * Step 4 is the important one. Combined figures — "total wealth", trading P&L shown in
 * shekels — are the whole point of the currency setting, and an exchange-rate API being
 * briefly down must not blank them out. A rate from yesterday is off by a fraction of a
 * percent; a dashboard that fails to load is off by everything. `stale` is returned so the UI
 * can say so when it matters.
 */

export type FxRate = {
  base: string;
  quote: string;
  rate: number;
  asOf: Date;
  /** True when the rate is not today's — the API was unreachable and this came from cache. */
  stale: boolean;
};

/**
 * How old a cached rate may be and still count as current.
 *
 * Four days covers a Friday close through a Monday morning, plus a public holiday on either
 * side. Beyond that the rate is served but flagged stale.
 */
const FRESH_WINDOW_DAYS = 4;

const IDENTITY = (currency: string): FxRate => ({
  base: currency,
  quote: currency,
  rate: 1,
  asOf: new Date(),
  stale: false,
});

/** Request-cached: a page converting fifty figures still resolves the rate once. */
export const getFxRate = cache(async (base: string, quote: string): Promise<FxRate> => {
  const from = base.toUpperCase();
  const to = quote.toUpperCase();
  if (from === to) return IDENTITY(from);

  const today = new Date();

  const cached = await readRecentRate(from, to, FRESH_WINDOW_DAYS);
  if (cached) return { base: from, quote: to, rate: cached.rate, asOf: cached.asOf, stale: false };

  const fetched = await fetchRate(from, to);
  if (fetched) {
    await writeCachedRate(from, to, fetched.rate, fetched.asOf);
    return { base: from, quote: to, rate: fetched.rate, asOf: fetched.asOf, stale: false };
  }

  const newest = await readNewestRate(from, to);
  if (newest) {
    return { base: from, quote: to, rate: newest.rate, asOf: newest.asOf, stale: true };
  }

  // Nothing cached and the API is unreachable: 1:1 would silently misstate every combined
  // figure, so the caller is told there is no rate and renders the source currency instead.
  return { base: from, quote: to, rate: Number.NaN, asOf: today, stale: true };
});

type FrankfurterResponse = { date: string; rates: Record<string, number> };

async function fetchRate(base: string, quote: string): Promise<{ rate: number; asOf: Date } | null> {
  try {
    const url = `${env().FX_API_URL}/latest?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      // Rates change once a day; Next's own cache saves the round trip within that window.
      next: { revalidate: 60 * 60 },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as FrankfurterResponse;
    const rate = body.rates?.[quote];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;

    return { rate, asOf: new Date(`${body.date}T00:00:00Z`) };
  } catch (error) {
    console.warn('[fx] rate fetch failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export function hasRate(fx: FxRate): boolean {
  return Number.isFinite(fx.rate);
}

export function convert(amount: number, fx: FxRate): number {
  return hasRate(fx) ? amount * fx.rate : amount;
}
