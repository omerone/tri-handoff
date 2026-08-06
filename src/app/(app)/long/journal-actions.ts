'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { updateLongPositionJournal } from '@/lib/db';
import type { JournalFormState } from '@/components/journal/journal-form';

export type { JournalFormState } from '@/components/journal/journal-form';

/**
 * The journal on a long-term holding.
 *
 * The same five fields, the same limits and the same messages as the synced trades' journal —
 * deliberately, because they are read together. The analytics group by strategy and by tag
 * across both books, so a 60-character cap on one side and no cap on the other would show up
 * as a truncated strategy that no longer matches the one it was typed to match.
 *
 * A separate action rather than a branch of `saveTradeJournalAction` because the row it writes
 * lives in another table with another owner: the quote refresh writes `currentPrice` on a
 * timer, and `updateLongPositionJournal` touches only the columns a person typed. One action
 * writing to whichever table an id happened to be found in is the kind of thing that works
 * until two ids collide.
 */
const journalSchema = z.object({
  id: z.string().min(1),
  note: z.string().trim().max(4_000),
  tags: z.string().max(500),
  rating: z.string(),
  mood: z.string().trim().max(40),
  strategy: z.string().trim().max(60),
});

/**
 * Comma-separated in the form, an array in the column.
 *
 * Case-insensitive dedupe on the way in and a cap of twenty, matching the trades journal
 * exactly. Both feed the same by-tag breakdown, and a tag list that is deduped on one side
 * only reports "revenge" and "Revenge" as two habits.
 */
function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const tag = part.trim();
    if (tag && ![...seen].some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      seen.add(tag);
    }
  }
  return [...seen].slice(0, 20);
}

export async function saveLongJournalAction(
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
  const saved = await updateLongPositionJournal(session.ctx, parsed.data.id, {
    note: parsed.data.note || null,
    tags: parseTags(parsed.data.tags),
    // An empty rating means "not rated", which is different from one star.
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    mood: parsed.data.mood || null,
    strategy: parsed.data.strategy || null,
  });
  if (!saved) return { error: t('invalid') };

  revalidatePath('/long');
  revalidatePath(`/long/${parsed.data.id}`);
  // A closed holding is folded into the trades table and the breakdowns, so its strategy and
  // tags are answers those screens give too.
  revalidatePath('/trades');
  revalidatePath('/analytics');
  return { notice: t('saved') };
}
