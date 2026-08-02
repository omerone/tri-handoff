import 'server-only';
import { prisma } from './prisma';

/**
 * The FX rate cache.
 *
 * Not tenant data — a euro is worth the same on every client's domain — so this is the one
 * table in the app that is deliberately shared. Keyed by (base, quote, date) so a historical
 * rate can be added later without changing the shape.
 */

export type CachedRate = { rate: number; asOf: Date; fetchedAt: Date };

/** Midnight UTC of a date, which is the granularity the daily rate feeds publish at. */
function dayOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function readCachedRate(
  base: string,
  quote: string,
  asOf: Date,
): Promise<CachedRate | null> {
  const row = await prisma.fxRate.findUnique({
    where: { base_quote_asOf: { base, quote, asOf: dayOf(asOf) } },
    select: { rate: true, asOf: true, fetchedAt: true },
  });
  return row ? { rate: Number(row.rate), asOf: row.asOf, fetchedAt: row.fetchedAt } : null;
}

/**
 * The newest rate published within the last `maxAgeDays`.
 *
 * Looking up *today* exactly was a design error: the feeds publish on business days, so on a
 * Saturday `readCachedRate(today)` misses, the fetch stores the rate under its own Friday
 * date, and the next request misses again — permanently, two days a week plus holidays, with
 * a live HTTP call on every render in between. A short window absorbs the weekend without
 * pretending a month-old rate is current.
 */
export async function readRecentRate(
  base: string,
  quote: string,
  maxAgeDays: number,
): Promise<CachedRate | null> {
  const floor = new Date(Date.now() - maxAgeDays * 86_400_000);
  const row = await prisma.fxRate.findFirst({
    where: { base, quote, asOf: { gte: dayOf(floor) } },
    orderBy: { asOf: 'desc' },
    select: { rate: true, asOf: true, fetchedAt: true },
  });
  return row ? { rate: Number(row.rate), asOf: row.asOf, fetchedAt: row.fetchedAt } : null;
}

/**
 * The most recent rate we hold, whatever its date.
 *
 * The fallback when the rate API is unreachable: a rate from yesterday is a far better
 * answer than an error page, and the UI says how old it is.
 */
export async function readNewestRate(base: string, quote: string): Promise<CachedRate | null> {
  const row = await prisma.fxRate.findFirst({
    where: { base, quote },
    orderBy: { asOf: 'desc' },
    select: { rate: true, asOf: true, fetchedAt: true },
  });
  return row ? { rate: Number(row.rate), asOf: row.asOf, fetchedAt: row.fetchedAt } : null;
}

export async function writeCachedRate(
  base: string,
  quote: string,
  rate: number,
  asOf: Date,
): Promise<void> {
  const day = dayOf(asOf);
  await prisma.fxRate.upsert({
    where: { base_quote_asOf: { base, quote, asOf: day } },
    create: { base, quote, rate, asOf: day },
    update: { rate, fetchedAt: new Date() },
  });
}
