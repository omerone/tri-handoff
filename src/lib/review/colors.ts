import { TOKEN } from '@/lib/theme';
import { topicKey } from '@/lib/learning/types';
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
 * The two the product ships with, in its own two brand tones — neither is the "good" one, so
 * neither gets a colour that implies it.
 */
export const TOPIC_COLOR: Record<string, string> = {
  psychology: TOKEN.brand2,
  technical: TOKEN.brand,
};

/**
 * Colours for topics the trader invented.
 *
 * Deliberately not the semantic tokens. `pos` and `neg` mean money everywhere else in this
 * product, and a study topic that happens to land on the loss colour reads as a judgement
 * about the topic. These are chosen to sit at a similar lightness so no slice shouts, and to
 * hold up on both the light and the dark ground without knowing which is in play — which is
 * why they are literals here rather than theme variables: there is no token for "a sixth
 * distinguishable hue", and inventing one per topic is what a palette is for.
 */
const CUSTOM_TOPIC_COLORS = [
  '#D9A24B', // amber
  '#8B7BFF', // violet
  '#4CC9E0', // cyan
  '#9BCF5F', // lime
  '#E8934B', // orange
  '#5B9BD5', // steel blue
] as const;

/**
 * A topic's colour: fixed for the two built-ins, and stable-by-name for everything else.
 *
 * Derived from the folded name rather than from the topic's position in a list, so a slice
 * does not change colour because another topic was added above it — the chart would otherwise
 * repaint itself every time the ledger grew, and a reader who had learned "the amber one is
 * back-testing" would be wrong the next week.
 */
export function topicColor(topic: string): string {
  const known = TOPIC_COLOR[topicKey(topic)];
  if (known) return known;

  let hash = 0;
  for (const char of topicKey(topic)) {
    hash = (hash * 31 + char.codePointAt(0)!) % 1_000_003;
  }
  return CUSTOM_TOPIC_COLORS[hash % CUSTOM_TOPIC_COLORS.length]!;
}
