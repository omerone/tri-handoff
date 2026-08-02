'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { updateTradeJournal } from '@/lib/db';

export type JournalFormState = { error?: string; notice?: string };

/**
 * The per-trade journal (SPEC §1.1, adopted from tradeReport).
 *
 * Everything here is the trader's own words about a trade, and the sync never touches these
 * columns — see the note in `upsertTrades`. That is what makes it safe to write: a refresh
 * cannot erase what someone spent a month recording.
 */
const journalSchema = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(4_000),
  // Comma-separated in the form; stored as an array so the "by tag" filter is an index hit
  // rather than a substring match that would treat "revenge" and "revenge-trade" as one tag.
  tags: z.string().max(500),
  rating: z.string(),
  mood: z.string().trim().max(40),
  strategy: z.string().trim().max(60),
});

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim();
    // Case-insensitive dedupe on the way in: "Breakout" and "breakout" as separate tags make
    // the breakdown meaningless within a month.
    if (tag && ![...seen].some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      seen.add(tag);
    }
  }
  return [...seen].slice(0, 20);
}

export async function saveTradeJournalAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const session = await requireSession();
  const t = await getTranslations('journal');

  const parsed = journalSchema.safeParse({
    id: formData.get('id'),
    note: formData.get('note') ?? '',
    tags: formData.get('tags') ?? '',
    rating: formData.get('rating') ?? '',
    mood: formData.get('mood') ?? '',
    strategy: formData.get('strategy') ?? '',
  });
  if (!parsed.success) return { error: t('invalid') };

  const rating = Number(parsed.data.rating);
  const saved = await updateTradeJournal(session.ctx, parsed.data.id, {
    note: parsed.data.note || null,
    tags: parseTags(parsed.data.tags),
    // An empty rating means "not rated", which is different from one star.
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    mood: parsed.data.mood || null,
    strategy: parsed.data.strategy || null,
  });
  if (!saved) return { error: t('invalid') };

  revalidatePath('/trades');
  revalidatePath(`/trades/${parsed.data.id}`);
  revalidatePath('/analytics');
  return { notice: t('saved') };
}
