'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { updateTradeReview } from '@/lib/db';
import { isTpTiming } from '@/lib/review/types';

export type ReviewState = { error?: string; ok?: boolean };

/**
 * One answer, from the row it belongs to.
 *
 * Deliberately narrow: it writes the single field it was given and nothing else. The journal
 * form saves every field it holds at once, so routing a dropdown through that would blank
 * whatever the trader had not retyped — a note lost to answering a two-option question is a
 * bad trade.
 *
 * Both fields accept an explicit clear. Changing an answer back to "not answered" is a real
 * correction, and an interface that can set but not unset teaches people not to touch it.
 */
export async function setTradeReviewAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await requireSession();

  const id = String(formData.get('id') ?? '');
  const field = String(formData.get('field') ?? '');
  const value = String(formData.get('value') ?? '');
  if (!id) return { error: 'missing id' };

  if (field === 'tpTiming') {
    const saved = await updateTradeReview(session.ctx, id, {
      tpTiming: isTpTiming(value) ? value : null,
    });
    if (!saved) return { error: 'not found' };
  } else if (field === 'tookOriginalTp') {
    const saved = await updateTradeReview(session.ctx, id, {
      tookOriginalTp: value === 'yes' ? true : value === 'no' ? false : null,
    });
    if (!saved) return { error: 'not found' };
  } else {
    return { error: 'unknown field' };
  }

  revalidatePath('/trades');
  revalidatePath(`/trades/${id}`);
  // Both answers are charted on the analytics screen.
  revalidatePath('/analytics');
  return { ok: true };
}
