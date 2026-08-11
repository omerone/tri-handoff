import { describe, expect, it } from 'vitest';
import {
  hoursDecimals,
  learningTotals,
  normalizeLearner,
  type LearningEntry,
} from './types';

const session = (over: Partial<LearningEntry> = {}): LearningEntry => ({
  id: crypto.randomUUID(),
  topic: 'technical',
  title: 'session',
  note: null,
  hours: 1,
  learnedOn: new Date('2026-08-01'),
  learner: null,
  ...over,
});

describe('learning totals', () => {
  it('weights by hours rather than by session count', () => {
    // Four short technical sessions against one long psychology one. Counting sessions would
    // say technical dominates; the trader actually spent more time on psychology.
    const totals = learningTotals([
      session({ topic: 'technical', hours: 0.25 }),
      session({ topic: 'technical', hours: 0.25 }),
      session({ topic: 'technical', hours: 0.25 }),
      session({ topic: 'technical', hours: 0.25 }),
      session({ topic: 'psychology', hours: 3 }),
    ]);

    const byTopic = Object.fromEntries(totals.byTopic.map((b) => [b.topic, b]));
    expect(byTopic.technical!.hours).toBe(1);
    expect(byTopic.technical!.sessions).toBe(4);
    expect(byTopic.psychology!.hours).toBe(3);
    expect(byTopic.psychology!.sessions).toBe(1);
  });

  it('keeps a topic that was never studied, at zero', () => {
    // The absence is the finding — a legend that drops the row hides it.
    const totals = learningTotals([session({ topic: 'technical', hours: 2 })]);

    expect(totals.byTopic.map((b) => b.topic)).toEqual(['psychology', 'technical']);
    expect(totals.byTopic.find((b) => b.topic === 'psychology')?.hours).toBe(0);
  });

  it('carries fractional hours through rather than rounding to whole ones', () => {
    const totals = learningTotals([
      session({ hours: 0.75 }),
      session({ hours: 0.5 }),
    ]);
    expect(totals.hours).toBeCloseTo(1.25);
  });

  it('totals the sessions as well as the hours', () => {
    const totals = learningTotals([
      session({ topic: 'psychology', hours: 1 }),
      session({ topic: 'technical', hours: 2 }),
    ]);
    expect(totals.hours).toBe(3);
    expect(totals.sessions).toBe(2);
  });

  it('reports zeros for an empty ledger without dropping the topics', () => {
    const totals = learningTotals([]);
    expect(totals.hours).toBe(0);
    expect(totals.sessions).toBe(0);
    expect(totals.byTopic).toHaveLength(2);
  });
});

describe('hours formatting', () => {
  it('drops the decimals a whole number does not need', () => {
    expect(hoursDecimals(3)).toBe(0);
    expect(hoursDecimals(0)).toBe(0);
  });

  it('keeps one decimal for a half hour', () => {
    // 2.5 rendered as "2.50h" was the reported eyesore.
    expect(hoursDecimals(2.5)).toBe(1);
    expect(hoursDecimals(1.5)).toBe(1);
  });

  it('keeps two for a quarter', () => {
    expect(hoursDecimals(0.75)).toBe(2);
    expect(hoursDecimals(1.25)).toBe(2);
  });

  it('is not fooled by binary floating point', () => {
    expect(hoursDecimals(0.1 + 0.2)).toBe(1);
  });
});

describe('who studied', () => {
  /**
   * One login, two people. The total on its own is the one number that cannot answer the
   * question the ledger exists for: eleven hours between them is a good month, or it is one
   * person carrying it, and those are different situations.
   */
  it('splits the hours per person, most studied first', () => {
    const totals = learningTotals([
      session({ learner: 'Ester', hours: 2 }),
      session({ learner: 'Shimon', hours: 5 }),
      session({ learner: 'Ester', hours: 1 }),
    ]);

    expect(totals.byLearner.map((row) => [row.learner, row.hours, row.sessions])).toEqual([
      ['Shimon', 5, 1],
      ['Ester', 3, 2],
    ]);
    expect(totals.hours).toBe(8);
  });

  it('folds two spellings of one name together, keeping the first', () => {
    // Names are typed, and a ledger split across "Ester" and "ester " is a ledger that answers
    // nothing. Folded for comparison only — the display keeps the spelling, because it is a
    // person's name and not a slug.
    const totals = learningTotals([
      session({ learner: 'Ester', hours: 1 }),
      session({ learner: 'ester ', hours: 2 }),
      session({ learner: '  ESTER', hours: 3 }),
    ]);

    expect(totals.byLearner).toHaveLength(1);
    expect(totals.byLearner[0]!.learner).toBe('Ester');
    expect(totals.byLearner[0]!.hours).toBe(6);
  });

  it('keeps unnamed sessions last, under their own heading', () => {
    // Null is "recorded before anyone was named", which is not a person — putting it at the
    // head of a list of people, or folding it into whoever is first, would both be wrong.
    const totals = learningTotals([
      session({ learner: null, hours: 9 }),
      session({ learner: 'Ester', hours: 1 }),
    ]);

    expect(totals.byLearner.map((row) => row.learner)).toEqual(['Ester', null]);
  });

  it('gives each person their own split of the craft', () => {
    const totals = learningTotals([
      session({ learner: 'Ester', topic: 'technical', hours: 4 }),
      session({ learner: 'Ester', topic: 'psychology', hours: 1 }),
      session({ learner: 'Shimon', topic: 'psychology', hours: 2 }),
    ]);

    const ester = totals.byLearner.find((row) => row.learner === 'Ester')!;
    expect(ester.byTopic).toEqual([
      { topic: 'psychology', hours: 1 },
      { topic: 'technical', hours: 4 },
    ]);
    // A person who never touched a topic still carries it at zero, so the absence is visible.
    const shimon = totals.byLearner.find((row) => row.learner === 'Shimon')!;
    expect(shimon.byTopic.find((slot) => slot.topic === 'technical')!.hours).toBe(0);
  });


  it('treats a blank name as no name at all', () => {
    // The field is optional and a form posts '' rather than nothing, so this is the common
    // case rather than an edge one: without it every unnamed session becomes a person called
    // empty string.
    expect(normalizeLearner('')).toBeNull();
    expect(normalizeLearner('   ')).toBeNull();
    expect(normalizeLearner(undefined)).toBeNull();
    expect(normalizeLearner('  Ester   Shimon ')).toBe('Ester Shimon');
  });
});
