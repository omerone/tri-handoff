/**
 * The study ledger.
 *
 * A sibling of the finance ledger rather than of the trade book: the trader keeps it by hand,
 * nothing syncs into it, and it answers a question the broker cannot — where the hours went.
 */

/**
 * What a session was about.
 *
 * It started as a two-value enum — the two halves a trader can be weak in independently, and
 * the reason the ledger records a topic at all. It is a free string now, because those two
 * are not the whole of the craft: an evening spent back-testing is neither, and a fixed list
 * means every new answer is a migration.
 *
 * The two originals stay *known*: they keep their own translated labels and their own colours,
 * so the screens they have always appeared on do not change. Anything else is shown as the
 * person typed it, which is the only sensible label for a word they chose.
 */
export type LearningTopic = string;

/** The two the product ships with, in the order they are offered. */
export const LEARNING_TOPICS = ['psychology', 'technical'] as const;

export type KnownLearningTopic = (typeof LEARNING_TOPICS)[number];

export function isKnownTopic(value: unknown): value is KnownLearningTopic {
  return typeof value === 'string' && (LEARNING_TOPICS as readonly string[]).includes(value);
}

/** Kept for the callers that only ever meant "is this a usable topic at all". */
export function isLearningTopic(value: unknown): value is LearningTopic {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The key two spellings of one topic agree on.
 *
 * Exactly the problem `learnerKey` solves for names, arrived at from the other direction:
 * "Back test", "back test" and "Backtest " are one topic however carefully anyone types, and
 * grouping on the raw string splits an evening's work across three rows and three colours.
 * Folded for comparison only — the display keeps the first spelling seen, because it is the
 * trader's word and not a slug.
 */
export function topicKey(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** What a topic looks like once stored: trimmed, inner runs of space collapsed. */
export function normalizeTopic(topic: string | null | undefined): string {
  return (topic ?? '').trim().replace(/\s+/g, ' ');
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
/**
 * Hours and sessions per topic — every topic that appears, plus the two built-ins.
 *
 * The built-ins are seeded even at zero so the chart keeps a stable legend, which is what it
 * has always done. Everything else is whatever the trader has written, folded on `topicKey`
 * so three spellings are one bucket, and labelled with the first spelling seen.
 *
 * The two built-ins keep their fixed positions at the front, whatever their hours. That is
 * deliberate and it is why they are seeded at zero in the first place: the legend under the
 * chart should not reshuffle itself because one evening's study overtook another. Topics the
 * trader invented follow, ordered by hours — they have no natural position, so the useful one
 * is where the time actually went.
 */
export function groupByTopic(
  entries: readonly LearningEntry[],
): { topic: LearningTopic; hours: number; sessions: number }[] {
  const buckets = new Map<string, { topic: LearningTopic; hours: number; sessions: number }>();

  for (const topic of LEARNING_TOPICS) {
    buckets.set(topicKey(topic), { topic, hours: 0, sessions: 0 });
  }

  /*
   * The label is the spelling of the *earliest* entry — the one that named the topic.
   *
   * "First spelling seen" is not the same thing, and the difference showed up immediately:
   * entries arrive newest-first, so a topic created as "Back test" and typed once more as
   * "back TEST" was labelled by the later, sloppier spelling. The name a topic was given
   * should not change because it was used again.
   */
  /*
   * Ordered before grouping, so the label does not depend on what the database happened to
   * return. Two sessions studied on the same day — the common case, since the form defaults to
   * today — tie on `learnedOn`, and without the second key the spelling flipped between them
   * from one page load to the next. `id` is a cuid, which sorts by creation, so the tiebreak
   * is "whichever was entered first" rather than anything arbitrary.
   */
  const inOrder = [...entries].sort((a, b) => {
    const byDate = a.learnedOn.getTime() - b.learnedOn.getTime();
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });

  for (const entry of inOrder) {
    const key = topicKey(entry.topic);
    if (key === '') continue;

    const bucket = buckets.get(key) ?? { topic: normalizeTopic(entry.topic), hours: 0, sessions: 0 };
    bucket.hours += entry.hours;
    bucket.sessions += 1;

    buckets.set(key, bucket);
  }

  const builtIn = LEARNING_TOPICS.map((topic) => buckets.get(topicKey(topic))!);
  const custom = [...buckets.entries()]
    .filter(([key]) => !LEARNING_TOPICS.some((topic) => topicKey(topic) === key))
    .map(([, bucket]) => bucket)
    .sort((a, b) => b.hours - a.hours);

  return [...builtIn, ...custom];
}

export function learningTotals(entries: readonly LearningEntry[]): LearningTotals {
  const byLearner = groupByLearner(entries);

  const byTopic = groupByTopic(entries);

  return {
    byTopic,
    byLearner,
    /*
     * Summed from the entries, not from the buckets.
     *
     * They agree, and they have to be written so that they cannot stop agreeing: the buckets
     * used to be built from a fixed list of two, so the day a third topic existed its hours
     * would have been missing from the total with nothing on screen to say so. Totalling the
     * source means a topic can only ever be missing from the *breakdown*, which is visible.
     */
    hours: entries.reduce((sum, entry) => sum + entry.hours, 0),
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

