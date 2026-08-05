/**
 * The study ledger.
 *
 * A sibling of the finance ledger rather than of the trade book: the trader keeps it by hand,
 * nothing syncs into it, and it answers a question the broker cannot — where the hours went.
 */

/**
 * Which half of the craft a session was about.
 *
 * Two answers because they are the two halves a trader can be weak in independently: reading
 * the chart, and sitting still while it plays out. A book full of technical study and no
 * psychology is a visible pattern, which is the reason to record it at all.
 */
export type LearningTopic = 'psychology' | 'technical';

export const LEARNING_TOPICS: readonly LearningTopic[] = ['psychology', 'technical'];

export function isLearningTopic(value: unknown): value is LearningTopic {
  return typeof value === 'string' && (LEARNING_TOPICS as readonly string[]).includes(value);
}

/**
 * A session as the app reads it. `hours` is fractional on purpose — forty-five minutes is
 * 0.75, not a rounded hour — because the chart is weighted by time rather than by count, and
 * ten minutes and an afternoon are not the same amount of study.
 */
export type LearningEntry = {
  id: string;
  topic: LearningTopic;
  title: string;
  note: string | null;
  hours: number;
  learnedOn: Date;
};

export type LearningTotals = {
  /** Hours per topic, every topic present even at zero so the chart keeps a stable legend. */
  byTopic: { topic: LearningTopic; hours: number; sessions: number }[];
  hours: number;
  sessions: number;
};

/**
 * Hours and session counts per topic.
 *
 * Every topic is emitted whether or not it was studied, so a month of pure technical work
 * shows psychology sitting at zero rather than dropping off the legend — the absence is the
 * finding.
 */
export function learningTotals(entries: readonly LearningEntry[]): LearningTotals {
  const byTopic = LEARNING_TOPICS.map((topic) => {
    const mine = entries.filter((entry) => entry.topic === topic);
    return {
      topic,
      hours: mine.reduce((sum, entry) => sum + entry.hours, 0),
      sessions: mine.length,
    };
  });

  return {
    byTopic,
    hours: byTopic.reduce((sum, bucket) => sum + bucket.hours, 0),
    sessions: entries.length,
  };
}

/**
 * How many decimals an hours figure deserves.
 *
 * Three hours reads better as "3h" than "3.00h", and forty-five minutes has to keep its
 * quarter — so the count follows the value rather than being fixed. Computed rather than
 * trimmed from a formatted string, because the decimal separator is not a dot in every
 * locale and trimming would eat the wrong character.
 */
export function hoursDecimals(value: number): 0 | 1 | 2 {
  if (Number.isInteger(value)) return 0;
  // A tenth is exact enough when the stored column is two decimals; the epsilon is there
  // because 0.1 + 0.2 is not 0.3 in binary floating point and 1.5 must not become 1.50.
  if (Math.abs(value * 10 - Math.round(value * 10)) < 1e-9) return 1;
  return 2;
}
