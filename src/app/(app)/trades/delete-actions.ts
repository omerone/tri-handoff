'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { deleteLongPositionsByIds, deleteTradesByIds } from '@/lib/db';

/**
 * Removing rows the trader picked out of the trades table.
 *
 * The table is a single population drawn from two tables — deals and closed holdings — and the
 * row keys say which is which (`trade:…`, `position:…`). Sorting them here rather than asking
 * the client to is deliberate: the split is a fact about storage, and a client that got it
 * wrong would be asking the server to delete a holding by a trade id, which silently matches
 * nothing and reports success.
 *
 * Two statements, not one per row. A hundred selected rows should cost two queries.
 */

const schema = z.object({
  // Bounded because it arrives from the client. A page holds forty rows and "select all" spans
  // the page, so this is generous; an unbounded `in` clause is a query somebody else writes.
  keys: z.array(z.string().min(1).max(200)).min(1).max(500),
});

export type DeleteRowsState = {
  error?: string;
  /** How many rows actually went, so the UI can report the truth rather than the request. */
  deleted?: number;
};

export async function deleteRowsAction(keys: string[]): Promise<DeleteRowsState> {
  const session = await requireSession();
  const t = await getTranslations('trades');

  const parsed = schema.safeParse({ keys });
  if (!parsed.success) return { error: t('delete.failed') };

  const tradeIds: string[] = [];
  const positionIds: string[] = [];
  for (const key of parsed.data.keys) {
    if (key.startsWith('trade:')) tradeIds.push(key.slice('trade:'.length));
    else if (key.startsWith('position:')) positionIds.push(key.slice('position:'.length));
    // Anything else is a key shape this build does not produce. Ignored rather than rejected:
    // one unrecognised row should not refuse the other ninety-nine.
  }

  if (tradeIds.length === 0 && positionIds.length === 0) return { error: t('delete.failed') };

  // Both scoped to the session's own user inside the delete itself, so an id belonging to
  // another tenant matches nothing rather than being caught by a check that could be skipped.
  const [trades, positions] = await Promise.all([
    deleteTradesByIds(session.ctx, tradeIds),
    deleteLongPositionsByIds(session.ctx, positionIds),
  ]);

  // Every screen reads this book — the calendar, the equity curve and each analytics
  // breakdown all move when a row goes.
  revalidatePath('/', 'layout');

  return { deleted: trades + positions };
}
