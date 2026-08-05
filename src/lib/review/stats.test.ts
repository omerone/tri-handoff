import { describe, expect, it } from 'vitest';
import { originalTpBreakdown, tpTimingBreakdown, type Answerable } from './stats';
import { originalTpAnswer } from './types';

const trade = (over: Partial<Answerable> = {}): Answerable => ({
  tpTiming: null,
  tookOriginalTp: null,
  ...over,
});

describe('take-profit timing', () => {
  it('reports every answer, including ones nobody chose', () => {
    const result = tpTimingBreakdown([
      trade({ tpTiming: 'early' }),
      trade({ tpTiming: 'early' }),
      trade({ tpTiming: 'onTime' }),
    ]);

    expect(result.slices.map((slice) => slice.key)).toEqual(['early', 'onTime', 'late']);
    expect(result.slices.map((slice) => slice.count)).toEqual([2, 1, 0]);
  });

  it('is a share of the reviewed trades, not of the whole book', () => {
    // Two answered, eight not. Early is half of what was reviewed, not a fifth of the book.
    const trades = [
      trade({ tpTiming: 'early' }),
      trade({ tpTiming: 'late' }),
      ...Array.from({ length: 8 }, () => trade()),
    ];
    const result = tpTimingBreakdown(trades);

    expect(result.total).toBe(2);
    expect(result.unanswered).toBe(8);
    expect(result.slices.find((slice) => slice.key === 'early')?.share).toBe(0.5);
  });

  it('keeps early and late apart', () => {
    // The whole reason this is not a boolean: they are different mistakes.
    const result = tpTimingBreakdown([trade({ tpTiming: 'early' }), trade({ tpTiming: 'late' })]);
    expect(result.slices.find((slice) => slice.key === 'early')?.count).toBe(1);
    expect(result.slices.find((slice) => slice.key === 'late')?.count).toBe(1);
  });

  it('does not divide by zero on an unreviewed book', () => {
    const result = tpTimingBreakdown([trade(), trade()]);
    expect(result.total).toBe(0);
    expect(result.slices.every((slice) => slice.share === 0)).toBe(true);
  });

  it('holds no opinion about an empty book', () => {
    const result = tpTimingBreakdown([]);
    expect(result.total).toBe(0);
    expect(result.unanswered).toBe(0);
  });
});

describe('original take-profit', () => {
  it('counts unanswered as its own slice', () => {
    const result = originalTpBreakdown([
      trade({ tookOriginalTp: true }),
      trade({ tookOriginalTp: false }),
      trade(),
    ]);

    expect(result.slices.map((slice) => slice.key)).toEqual(['yes', 'no', 'unanswered']);
    expect(result.slices.map((slice) => slice.count)).toEqual([1, 1, 1]);
    expect(result.total).toBe(3);
  });

  it('does not let an unreviewed book read as perfect discipline', () => {
    // One trade reviewed as "yes" out of ten. Anything that reported 100% here would be
    // describing the paperwork rather than the trading.
    const trades = [trade({ tookOriginalTp: true }), ...Array.from({ length: 9 }, () => trade())];
    const result = originalTpBreakdown(trades);

    expect(result.slices.find((slice) => slice.key === 'yes')?.share).toBeCloseTo(0.1);
    expect(result.slices.find((slice) => slice.key === 'unanswered')?.count).toBe(9);
  });

  it('sums to the whole book', () => {
    const trades = [
      trade({ tookOriginalTp: true }),
      trade({ tookOriginalTp: true }),
      trade({ tookOriginalTp: false }),
      trade(),
    ];
    const result = originalTpBreakdown(trades);

    expect(result.slices.reduce((sum, slice) => sum + slice.count, 0)).toBe(trades.length);
    expect(result.slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });
});

describe('answer mapping', () => {
  it('separates a recorded no from an absent answer', () => {
    expect(originalTpAnswer(true)).toBe('yes');
    expect(originalTpAnswer(false)).toBe('no');
    expect(originalTpAnswer(null)).toBe('unanswered');
  });
});
