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
  /** Who studied. Null for a session recorded before anyone was named. */
  learner: string | null;
};

/**
 * The key two spellings of one name agree on.
 *
 * Names are typed, and "Ester", "ester" and "Ester " are one person however carefully anyone
 * types. Grouping on the raw string splits their hours across three rows and the ledger stops
 * answering the question it exists for. Folded for comparison only — the display keeps the
 * first spelling seen, because it is that person's name and not a slug.
 */
export function learnerKey(name: string | null): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** What a name looks like once stored: trimmed, inner runs of space collapsed. */
export function normalizeLearner(name: string | null | undefined): string | null {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ');
  return clean === '' ? null : clean;
}

export type LearnerTotals = {
  /** As first written by whoever entered it, not folded. */
  learner: string | null;
  hours: number;
  sessions: number;
  /** Their split of the craft, so "who studied" and "what they studied" are one answer. */
  byTopic: { topic: LearningTopic; hours: number }[];
};

export type LearningTotals = {
  /** Hours per topic, every topic present even at zero so the chart keeps a stable legend. */
  byTopic: { topic: LearningTopic; hours: number; sessions: number }[];
  /**
   * Hours per person, most studied first, with unattributed sessions last.
   *
   * The account is one login shared by two people, so the total on its own hides the thing
   * worth knowing: eleven hours between them is a good month or one person carrying it,
   * and those are different situations. Unattributed sits at the end under its own heading
   * rather than being folded into whoever is alphabetically first.
   */
  byLearner: LearnerTotals[];
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
  const byLearner = groupByLearner(entries);

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
    byLearner,
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

/**
 * Hours per person, folded on a case-insensitive key and labelled with the first spelling.
 *
 * Sorted by hours rather than by name: the ledger is read to see who is putting the work in,
 * and alphabetical order answers a question nobody asked. Unattributed sessions come last
 * whatever their total, because "nobody wrote a name" is not a person and should not head the
 * list of people.
 */
export function groupByLearner(entries: readonly LearningEntry[]): LearnerTotals[] {
  const groups = new Map<string, LearnerTotals>();

  for (const entry of entries) {
    const key = learnerKey(entry.learner);
    let group = groups.get(key);
    if (!group) {
      group = {
        learner: entry.learner,
        hours: 0,
        sessions: 0,
        byTopic: LEARNING_TOPICS.map((topic) => ({ topic, hours: 0 })),
      };
      groups.set(key, group);
    }
    group.hours += entry.hours;
    group.sessions += 1;
    const topic = group.byTopic.find((slot) => slot.topic === entry.topic);
    if (topic) topic.hours += entry.hours;
  }

  return [...groups.values()].sort((a, b) => {
    if ((a.learner === null) !== (b.learner === null)) return a.learner === null ? 1 : -1;
    return b.hours - a.hours;
  });
}

