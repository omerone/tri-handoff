'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import {
  deleteFinanceEntriesByIds,
  deleteLearningEntriesByIds,
  deleteLongPositionsByIds,
  deleteTradesByIds,
} from '@/lib/db';

/**
 * Removing the rows a person picked out of a list.
 *
 * One file for the four lists that have one, because the shape is identical and the only thing
 * that differs is which table the ids belong to. Each is its own action rather than one action
 * taking a table name: a client that could name the table is a client that could name a table
 * nobody meant it to reach, and the whole point of these is that they delete.
 *
 * Every delete is scoped to the session's own user *inside* the statement, so an id belonging
 * to another tenant matches nothing rather than being caught by a check that a future caller
 * could skip.
 */

const schema = z.object({
  // Bounded because it arrives from the client. These lists are a screenful, so this is
  // generous; an unbounded `in` clause is a query somebody else gets to write.
  ids: z.array(z.string().min(1).max(200)).min(1).max(500),
});

export type BulkDeleteState = {
  error?: string;
  /** How many rows actually went, so the UI can report the truth rather than the request. */
  deleted?: number;
};

/** Parses, or explains itself in the reader's language. */
async function ids(raw: string[]): Promise<{ ok: string[] } | { error: string }> {
  const t = await getTranslations('bulk');
  const parsed = schema.safeParse({ ids: raw });
  return parsed.success ? { ok: parsed.data.ids } : { error: t('failed') };
}

/**
 * Finance entries.
 *
 * The keys arriving here are occurrence keys — `id:date` — because a recurring entry is drawn
 * once per month it falls in, and a range spanning a quarter draws January's salary three
 * times. Deleting takes the *entry*, so the id is what matters and the same one can arrive
 * three times; `Set` is the whole of that. The confirmation says the series goes with it,
 * which is why "end series" still exists beside this as a different answer.
 */
export async function deleteFinanceEntriesAction(keys: string[]): Promise<BulkDeleteState> {
  const session = await requireSession();
  const parsed = await ids(keys);
  if ('error' in parsed) return parsed;

  const unique = [...new Set(parsed.ok.map((key) => key.split(':')[0]!))];
  const deleted = await deleteFinanceEntriesByIds(session.ctx, unique);

  // The finance figures reach the dashboard and the wealth total, not just this page.
  revalidatePath('/', 'layout');
  return { deleted };
}

/** Learning entries. */
export async function deleteLearningEntriesAction(keys: string[]): Promise<BulkDeleteState> {
  const session = await requireSession();
  const parsed = await ids(keys);
  if ('error' in parsed) return parsed;

  const deleted = await deleteLearningEntriesByIds(session.ctx, parsed.ok);
  revalidatePath('/', 'layout');
  return { deleted };
}

/** Long-term holdings, open or closed. */
export async function deleteLongPositionsAction(keys: string[]): Promise<BulkDeleteState> {
  const session = await requireSession();
  const parsed = await ids(keys);
  if ('error' in parsed) return parsed;

  const deleted = await deleteLongPositionsByIds(session.ctx, parsed.ok);
  revalidatePath('/', 'layout');
  return { deleted };
}

/**
 * Hand-entered trades.
 *
 * These are rows in `trades` with a `manual:` ticket, so the same delete the trades table uses
 * covers them — and it is scoped to the user, so an id from the synced half of the book would
 * only match if it were the caller's own. That is the correct outcome either way: a trade the
 * person is looking at and asking to remove.
 */
export async function deleteManualTradesAction(keys: string[]): Promise<BulkDeleteState> {
  const session = await requireSession();
  const parsed = await ids(keys);
  if ('error' in parsed) return parsed;

  const deleted = await deleteTradesByIds(session.ctx, parsed.ok);
  revalidatePath('/', 'layout');
  return { deleted };
}
