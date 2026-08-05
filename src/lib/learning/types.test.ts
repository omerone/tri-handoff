import { describe, expect, it } from 'vitest';
import { learningTotals, type LearningEntry } from './types';

const session = (over: Partial<LearningEntry> = {}): LearningEntry => ({
  id: crypto.randomUUID(),
  topic: 'technical',
  title: 'session',
  note: null,
  hours: 1,
  learnedOn: new Date('2026-08-01'),
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
