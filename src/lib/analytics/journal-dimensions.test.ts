import { describe, expect, it } from 'vitest';
import { byMood, byRating, NO_MOOD, UNRATED } from './dimensions';
import type { AnalyticsTrade } from './types';

let seq = 0;
const trade = (over: Partial<AnalyticsTrade> = {}): AnalyticsTrade => {
  seq += 1;
  const openAt = new Date(Date.UTC(2026, 6, 1, 9, 0) + seq * 3_600_000);
  return {
    id: `t${seq}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt,
    closeAt: new Date(openAt.getTime() + 3_600_000),
    profit: 0,
    // Costs and size are not what these tests are about; the engine needs them present.
    commission: 0,
    swap: 0,
    volume: 1,
    mae: null,
    mfe: null,
    risk: null,
    rr: null,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
    ...over,
  };
};

const keys = (buckets: { key: string }[]) => buckets.map((b) => b.key);
const find = (buckets: { key: string; metrics: { net: number; count: number } }[], key: string) =>
  buckets.find((b) => b.key === key)?.metrics;

describe('by self-rating', () => {
  it('separates what the trader scored well from what they did not', () => {
    const buckets = byRating([
      trade({ rating: 5, profit: 400 }),
      trade({ rating: 5, profit: 200 }),
      trade({ rating: 1, profit: -300 }),
    ]);

    expect(find(buckets, '5')?.net).toBe(600);
    expect(find(buckets, '1')?.net).toBe(-300);
  });

  it('keeps unrated trades as a bucket rather than dropping them', () => {
    // Four hundred trades and forty rated: the comparison has to show what it rests on.
    const buckets = byRating([trade({ rating: 4, profit: 100 }), trade({ profit: -100 })]);

    expect(keys(buckets)).toContain(UNRATED);
    expect(find(buckets, UNRATED)?.count).toBe(1);
  });

  it('offers only the scores actually used', () => {
    const buckets = byRating([trade({ rating: 3, profit: 10 }), trade({ rating: 5, profit: 10 })]);
    expect(keys(buckets)).toEqual(['3', '5']);
  });

  it('sums back to the whole book', () => {
    const trades = [
      trade({ rating: 1, profit: -50 }),
      trade({ rating: 5, profit: 300 }),
      trade({ profit: 25 }),
    ];
    const total = byRating(trades).reduce((sum, b) => sum + b.metrics.count, 0);
    expect(total).toBe(trades.length);
  });
});

describe('by mood', () => {
  it('buckets by the words the trader actually used', () => {
    const buckets = byMood([
      trade({ mood: 'revenge', profit: -500 }),
      trade({ mood: 'calm', profit: 200 }),
      trade({ mood: 'calm', profit: 300 }),
    ]);

    expect(find(buckets, 'revenge')?.net).toBe(-500);
    expect(find(buckets, 'calm')?.net).toBe(500);
  });

  it('treats different casings as one mood, not two half-rows', () => {
    const buckets = byMood([
      trade({ mood: 'Calm', profit: 100 }),
      trade({ mood: 'calm', profit: 100 }),
      trade({ mood: 'CALM', profit: 100 }),
    ]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.metrics.count).toBe(3);
  });

  it('reads the label back the way it was first typed', () => {
    const buckets = byMood([trade({ mood: 'FOMO', profit: 1 }), trade({ mood: 'fomo', profit: 1 })]);
    expect(keys(buckets)).toEqual(['FOMO']);
  });

  it('does not let whitespace invent a mood', () => {
    const buckets = byMood([trade({ mood: '   ', profit: 10 }), trade({ mood: 'calm', profit: 10 })]);

    expect(keys(buckets)).toEqual(['calm', NO_MOOD]);
    expect(find(buckets, NO_MOOD)?.count).toBe(1);
  });

  it('sums back to the whole book', () => {
    const trades = [
      trade({ mood: 'calm', profit: 10 }),
      trade({ mood: 'tilted', profit: -10 }),
      trade({ profit: 5 }),
    ];
    const total = byMood(trades).reduce((sum, b) => sum + b.metrics.count, 0);
    expect(total).toBe(trades.length);
  });

  it('holds no opinion about an empty book', () => {
    expect(byMood([])).toEqual([]);
    expect(byRating([])).toEqual([]);
  });
});
