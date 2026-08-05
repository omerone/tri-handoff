import { TOKEN } from '@/lib/theme';
import type { LearningTopic } from '@/lib/learning/types';
import type { OriginalTpAnswer, TpTiming } from './types';

/**
 * Slice colours for the share-of-total donuts.
 *
 * Chosen by meaning rather than by palette order, so the charts can be read before the legend
 * is. On-time and "yes" are the outcome the plan intended, so they take the positive token;
 * early and late are both departures from it, and "no" is a departure from the plan, so they
 * take warn and negative. Unanswered is deliberately the dim token — it is the absence of a
 * judgement, and it should not compete with the answers for attention.
 *
 * These are CSS variables, so every slice follows the light and dark themes without this
 * file knowing which one is in play.
 */

export const TIMING_COLOR: Record<TpTiming, string> = {
  early: TOKEN.warn,
  onTime: TOKEN.pos,
  late: TOKEN.neg,
};

export const ORIGINAL_TP_COLOR: Record<OriginalTpAnswer, string> = {
  yes: TOKEN.pos,
  no: TOKEN.neg,
  unanswered: TOKEN.dim,
};

/**
 * The two halves of the craft, in the product's two brand tones — neither is the "good" one,
 * so neither gets a colour that implies it.
 */
export const TOPIC_COLOR: Record<LearningTopic, string> = {
  psychology: TOKEN.brand2,
  technical: TOKEN.brand,
};
