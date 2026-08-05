/**
 * The two questions asked about a closed trade, after the fact.
 *
 * They are review, not record: the broker reports what happened, and these say whether it
 * matched the plan. Kept apart from `@/lib/mt5/types` for exactly that reason — nothing here
 * comes off a wire, and the sync is forbidden from writing either of them.
 */

/**
 * When the exit happened relative to the plan.
 *
 * Three answers rather than a boolean. "Early" and "late" are different mistakes — one is
 * nerves, the other is greed — and they have different fixes, so collapsing them into "not on
 * time" would hide which one a trader keeps making, which is the whole point of asking.
 */
export type TpTiming = 'early' | 'onTime' | 'late';

/** Ordered early → late, so the chart reads in the direction time runs. */
export const TP_TIMINGS: readonly TpTiming[] = ['early', 'onTime', 'late'];

export function isTpTiming(value: unknown): value is TpTiming {
  return typeof value === 'string' && (TP_TIMINGS as readonly string[]).includes(value);
}

/**
 * Whether the trade closed at the take-profit it was opened with.
 *
 * Stored as a nullable boolean, but charted as three groups: yes, no, and not yet answered.
 * A trade nobody has reviewed is not the same as a trade reviewed as "no", and a pie that
 * silently drops the unanswered ones would report a cleaner discipline than the book shows.
 */
export type OriginalTpAnswer = 'yes' | 'no' | 'unanswered';

export const ORIGINAL_TP_ANSWERS: readonly OriginalTpAnswer[] = ['yes', 'no', 'unanswered'];

export function originalTpAnswer(value: boolean | null): OriginalTpAnswer {
  if (value === null) return 'unanswered';
  return value ? 'yes' : 'no';
}
