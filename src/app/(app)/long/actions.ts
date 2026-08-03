'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import {
  closeLongPosition,
  createLongPosition,
  deleteLongPosition,
  getLongPosition,
  setPriceSource,
  trackAllOpenPositions,
  updateCurrentPrice,
} from '@/lib/db';
import { realizedPnlOnClose } from '@/lib/positions/valuation';
import { SUPPORTED_CURRENCIES } from '@/lib/money/currency';
import { isPlausibleDate } from '@/lib/finance/bounds';

export type PositionFormState = { error?: string; ok?: boolean };

/**
 * The columns are `Decimal(20,8)` — twelve integer digits. Anything larger is a Postgres
 * numeric overflow thrown straight out of the action as a 500, so the bound is here rather
 * than discovered at the database.
 */
const MAX_DECIMAL = 1e11;

const createSchema = z.object({
  symbol: z.string().trim().min(1).max(24).toUpperCase(),
  qty: z.coerce.number().positive().finite().max(MAX_DECIMAL),
  buyPrice: z.coerce.number().positive().finite().max(MAX_DECIMAL),
  buyDate: z.coerce.date().refine((date) => isPlausibleDate(date)),
  fees: z.coerce.number().min(0).finite().max(MAX_DECIMAL).default(0),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  /**
   * Both are set by the search box, and only by it. A symbol typed freehand gets neither, so
   * it stays a manually priced position — which is exactly right: the feed has no idea what
   * an arbitrary string is, and a position it cannot price must not claim to be tracked.
   */
  micCode: z.string().trim().max(12).default(''),
  priceSource: z.enum(['auto', 'manual']).default('manual'),
});

export async function createPositionAction(
  _prev: PositionFormState,
  formData: FormData,
): Promise<PositionFormState> {
  const session = await requireSession();
  const t = await getTranslations('long');

  const parsed = createSchema.safeParse({
    symbol: formData.get('symbol'),
    qty: formData.get('qty'),
    buyPrice: formData.get('buyPrice'),
    buyDate: formData.get('buyDate'),
    fees: formData.get('fees') || 0,
    currency: formData.get('currency') || 'USD',
    micCode: formData.get('micCode') || '',
    priceSource: formData.get('priceSource') || 'manual',
  });
  if (!parsed.success) return { error: t('invalid') };

  await createLongPosition(session.ctx, parsed.data);
  revalidatePath('/long');
  return { ok: true };
}

const priceSourceSchema = z.object({
  id: z.string().min(1),
  priceSource: z.enum(['auto', 'manual']),
});

/**
 * Puts a position back on the feed after a manual correction, or takes it off deliberately.
 *
 * No price is fetched here. The refresh runs on its own timer and picks the position up on
 * its next tick — making the user wait on a network call to flip a switch would be the one
 * place in this feature where a vendor being slow is visible as a slow click.
 */
export async function setPriceSourceAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const parsed = priceSourceSchema.safeParse({
    id: formData.get('id'),
    priceSource: formData.get('priceSource'),
  });
  if (!parsed.success) return;

  await setPriceSource(session.ctx, parsed.data.id, parsed.data.priceSource);
  revalidatePath('/long');
}

/** Switches a whole existing book onto the feed at once — see `trackAllOpenPositions`. */
export async function trackAllAction(): Promise<void> {
  const session = await requireSession();
  await trackAllOpenPositions(session.ctx);
  revalidatePath('/long');
}

const priceSchema = z.object({
  id: z.string().min(1),
  currentPrice: z.coerce.number().positive().finite().max(MAX_DECIMAL),
});

export async function updatePriceAction(
  _prev: PositionFormState,
  formData: FormData,
): Promise<PositionFormState> {
  const session = await requireSession();
  const t = await getTranslations('long');

  const parsed = priceSchema.safeParse({
    id: formData.get('id'),
    currentPrice: formData.get('currentPrice'),
  });
  if (!parsed.success) return { error: t('invalid') };

  await updateCurrentPrice(session.ctx, parsed.data.id, parsed.data.currentPrice);
  revalidatePath('/long');
  return { ok: true };
}

const closeSchema = z.object({
  id: z.string().min(1),
  sellPrice: z.coerce.number().positive().finite().max(MAX_DECIMAL),
});

/**
 * Closes a position.
 *
 * The realized figure is computed here, from the position as it stands, and stored — see
 * `closeLongPosition`. Deriving it on read would mean a later correction to the buy price
 * silently rewriting a gain that was already banked.
 */
export async function closePositionAction(
  _prev: PositionFormState,
  formData: FormData,
): Promise<PositionFormState> {
  const session = await requireSession();
  const t = await getTranslations('long');

  const parsed = closeSchema.safeParse({
    id: formData.get('id'),
    sellPrice: formData.get('sellPrice'),
  });
  if (!parsed.success) return { error: t('invalid') };

  const position = await getLongPosition(session.ctx, parsed.data.id);
  if (!position || position.closedAt !== null) return { error: t('invalid') };

  await closeLongPosition(session.ctx, parsed.data.id, {
    sellPrice: parsed.data.sellPrice,
    realizedPnl: realizedPnlOnClose(position, parsed.data.sellPrice),
    closedAt: new Date(),
  });

  revalidatePath('/long');
  return { ok: true };
}

export async function deletePositionAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  await deleteLongPosition(session.ctx, id);
  revalidatePath('/long');
}
