'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { createManualTrade, deleteManualTrade, getMt5Account } from '@/lib/db';
import { computeRisk } from '@/lib/mt5/risk';
import { classifySymbol, normalizeSymbol } from '@/lib/mt5/symbols';

export type ManualTradeFormState = { error?: string; notice?: string };

/**
 * Adding and removing a hand-typed day or swing trade.
 *
 * The form is deliberately forgiving about what it needs: a symbol, a side, a date and a
 * result. Everything else is optional, because the alternative is a trader with a notebook
 * full of trades and a form that will not accept any of them until they look up a contract
 * size. What they do fill in is used — see `riskOf`.
 */

/** Longest symbol accepted. Broker tickers run to about twenty characters with a suffix. */
const MAX_SYMBOL = 40;

const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const requiredNumber = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value), { message: 'not a number' });

const schema = z.object({
  symbol: z.string().trim().min(1).max(MAX_SYMBOL),
  direction: z.enum(['long', 'short']),
  style: z.enum(['day', 'swing']),
  closeDate: z.string().min(1),
  openDate: z.string().optional(),
  profit: requiredNumber,
  risk: optionalNumber,
  volume: optionalNumber,
  entryPrice: optionalNumber,
  exitPrice: optionalNumber,
  stopLoss: optionalNumber,
  takeProfit: optionalNumber,
  commission: optionalNumber,
  swap: optionalNumber,
});

/**
 * Midday in UTC for a `YYYY-MM-DD` the trader picked.
 *
 * Midday, not midnight: every screen buckets by the analytics time zone, which is two or
 * three hours ahead of UTC, so a trade stamped at 00:00 UTC lands on the *previous* day in
 * the calendar and in the monthly grid. Noon is far enough from both boundaries that no
 * daylight-saving shift can move it.
 */
function instantFor(day: string, fallback?: string): Date | null {
  const value = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : (fallback ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The risk to store, from whichever the trader gave us.
 *
 * Two routes, and the derived one wins when it is available. Entry, stop and volume are facts
 * about the trade; a typed risk is someone's recollection of one, and where both exist the
 * arithmetic is the better witness. `computeRisk` is the same function the sync uses, so a
 * hand-typed trade's risk means exactly what a synced trade's risk means — which is the only
 * reason the two can share a chart.
 *
 * When the symbol has no contract specification the derivation returns null and the typed
 * figure is used instead. That is the common case for anyone journalling an instrument the
 * static table has never heard of, and refusing the trade over it would be absurd.
 */
function riskOf(
  input: {
    symbol: string;
    volume: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    risk: number | null;
  },
  accountCurrency: string,
): number | null {
  if (input.volume !== null && input.entryPrice !== null && input.stopLoss !== null) {
    const derived = computeRisk({
      symbol: input.symbol,
      volume: input.volume,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      accountCurrency,
    });
    if (derived.risk !== null) return derived.risk;
  }

  // A negative or zero risk is not a smaller risk, it is a typo. Dropped rather than stored,
  // so it lands in the RR coverage figure as "no R" instead of producing an infinite one.
  return input.risk !== null && input.risk > 0 ? input.risk : null;
}

export async function createManualTradeAction(
  _prev: ManualTradeFormState,
  formData: FormData,
): Promise<ManualTradeFormState> {
  const session = await requireSession();
  const t = await getTranslations('manual');

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t('invalid') };
  const input = parsed.data;

  const closeAt = instantFor(input.closeDate);
  if (!closeAt) return { error: t('invalidDate') };
  // An open date is optional and defaults to the close date — which is exactly right for a
  // day trade and merely unknown for a swing, where it makes the hold time zero rather than
  // wrong in some more interesting direction.
  const openAt = instantFor(input.openDate ?? '', input.closeDate) ?? closeAt;
  if (openAt > closeAt) return { error: t('openAfterClose') };

  const symbol = normalizeSymbol(input.symbol);
  const account = await getMt5Account(session.ctx);
  const accountCurrency = account?.accountCurrency ?? 'USD';

  const risk = riskOf(
    {
      symbol,
      volume: input.volume,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      risk: input.risk,
    },
    accountCurrency,
  );

  /*
   * `profit` is taken as typed and *not* adjusted by the commission and swap fields.
   *
   * Everywhere else in the product `profit` is net, and the sync reaches that by adding the
   * broker's signed costs to its gross. Here the trader is reading a number off their
   * platform, and the number on a platform's history line is already what the balance moved
   * by. Subtracting the costs again would double-count them. The cost fields are recorded so
   * the costs card can still take them apart — `grossOf` adds them back — which is the same
   * relationship a synced trade has.
   */
  const profit = input.profit;

  await createManualTrade(session.ctx, {
    symbol,
    assetClass: classifySymbol(symbol),
    direction: input.direction,
    style: input.style,
    openAt,
    closeAt,
    profit,
    risk,
    rr: risk !== null && risk > 0 ? profit / risk : null,
    volume: input.volume ?? 0,
    entryPrice: input.entryPrice ?? 0,
    exitPrice: input.exitPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    commission: input.commission ?? 0,
    swap: input.swap ?? 0,
  });

  // Every screen reads the same table, so all of them are now out of date.
  revalidatePath('/', 'layout');
  return { notice: t('added') };
}

export async function deleteManualTradeAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  // Returns false for a synced trade, one belonging to someone else, or one already gone —
  // the caller is told nothing either way, and there is nothing useful to say.
  await deleteManualTrade(session.ctx, id);
  revalidatePath('/', 'layout');
}
