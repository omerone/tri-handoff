import { describe, expect, it } from 'vitest';
import {
  BAND,
  concentration,
  dayLoads,
  EMPTY_UNDERWATER,
  riskConsistency,
  underwater,
} from './consistency';
import { equityCurve } from './metrics';
import type { AnalyticsTrade } from './types';

let seq = 0;

function trade(over: Partial<AnalyticsTrade> = {}): AnalyticsTrade {
  seq += 1;
  return {
    id: `t${seq}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt: new Date('2026-07-01T10:00:00Z'),
    closeAt: new Date('2026-07-01T14:00:00Z'),
    profit: 0,
    commission: 0,
    swap: 0,
    volume: 1,
    risk: null,
    rr: null,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
    ...over,
  };
}

/** A trade closed at noon Jerusalem time on a given day, so the date key is unambiguous. */
const onDay = (day: string, profit: number, over: Partial<AnalyticsTrade> = {}) =>
  trade({ closeAt: new Date(`${day}T09:00:00Z`), profit, ...over });

describe('riskConsistency', () => {
  it('is empty when nothing carried a stop, and still reports the total', () => {
    const result = riskConsistency([trade(), trade()]);
    expect(result.covered).toBe(0);
    expect(result.total).toBe(2);
    expect(result.variation).toBeNull();
  });

  it('excludes trades with no risk rather than counting them as zero', () => {
    // Zeroing them would halve the mean and invent discipline that is not there.
    const result = riskConsistency([trade({ risk: 100 }), trade({ risk: null }), trade({ risk: 100 })]);
    expect(result.covered).toBe(2);
    expect(result.total).toBe(3);
    expect(result.mean).toBe(100);
  });

  it('reports zero variation for perfectly uniform sizing', () => {
    const result = riskConsistency([100, 100, 100, 100].map((risk) => trade({ risk })));
    expect(result.stdDev).toBe(0);
    expect(result.variation).toBe(0);
    expect(result.withinBand).toBe(100);
  });

  it('computes the population standard deviation, not the sample one', () => {
    // Risks 2 and 4: mean 3, population variance ((1)+(1))/2 = 1, so sd = 1.
    // The sample form would divide by 1 and give sd = √2 ≈ 1.414.
    const result = riskConsistency([trade({ risk: 2 }), trade({ risk: 4 })]);
    expect(result.mean).toBe(3);
    expect(result.stdDev).toBe(1);
    expect(result.variation).toBeCloseTo(1 / 3, 10);
  });

  it('takes the median of an even-length book from the middle pair', () => {
    const result = riskConsistency([1, 2, 4, 5].map((risk) => trade({ risk })));
    expect(result.median).toBe(3);
    expect(result.min).toBe(1);
    expect(result.max).toBe(5);
  });

  it('catches the trader who risks 1% four times and 5% once', () => {
    const result = riskConsistency(
      [100, 100, 100, 100, 500].map((risk) => trade({ risk })),
    );
    // The win rate would say nothing about this; the dispersion says it plainly.
    expect(result.variation).toBeGreaterThan(0.5);
    expect(result.withinBand).toBe(80);
    expect(result.max / result.min).toBe(5);
  });

  it('counts the band inclusively at both edges', () => {
    const median = 100;
    const result = riskConsistency([
      trade({ risk: median }),
      trade({ risk: median * (1 - BAND) }),
      trade({ risk: median * (1 + BAND) }),
    ]);
    expect(result.withinBand).toBe(100);
  });

  it('ignores a nonsensical risk rather than letting it poison the mean', () => {
    const result = riskConsistency([trade({ risk: 100 }), trade({ risk: 0 }), trade({ risk: 100 })]);
    expect(result.covered).toBe(2);
    expect(result.mean).toBe(100);
  });
});

describe('concentration', () => {
  it('has no share to report when nothing won', () => {
    const result = concentration([trade({ profit: -10 }), trade({ profit: -20 })]);
    expect(result.topShare).toBeNull();
    expect(result.grossWin).toBe(0);
  });

  it('measures the top winners against gross profit, not against net', () => {
    // Winners 100, 50, 30, 20 = 200 gross. Top three = 180 = 90%.
    const result = concentration([
      trade({ profit: 100 }),
      trade({ profit: 50 }),
      trade({ profit: 30 }),
      trade({ profit: 20 }),
      trade({ profit: -60 }),
    ]);
    expect(result.grossWin).toBe(200);
    expect(result.topShare).toBeCloseTo(90, 10);
    expect(result.net).toBe(140);
  });

  it('spots a book that rests on one trade', () => {
    const result = concentration([
      trade({ profit: 1000 }),
      trade({ profit: -100 }),
      trade({ profit: -100 }),
      trade({ profit: -100 }),
    ]);
    expect(result.net).toBe(700);
    expect(result.netWithoutBest).toBe(-300);
    expect(result.restsOnOneTrade).toBe(true);
  });

  it('does not call a broadly profitable book concentrated', () => {
    const result = concentration([
      trade({ profit: 100 }),
      trade({ profit: 100 }),
      trade({ profit: 100 }),
      trade({ profit: 100 }),
    ]);
    expect(result.netWithoutBest).toBe(300);
    expect(result.restsOnOneTrade).toBe(false);
  });

  it('says nothing about a losing book resting on a trade', () => {
    // A losing book does not rest on anything; the flag would be noise.
    const result = concentration([trade({ profit: 50 }), trade({ profit: -500 })]);
    expect(result.net).toBe(-450);
    expect(result.restsOnOneTrade).toBe(false);
  });

  it('reports how many winners the share actually covers', () => {
    const result = concentration([trade({ profit: 10 }), trade({ profit: -5 })]);
    expect(result.topCount).toBe(1);
    expect(result.topShare).toBe(100);
  });
});

describe('underwater', () => {
  it('is empty for an empty curve', () => {
    expect(underwater([], 1000)).toEqual(EMPTY_UNDERWATER);
  });

  it('is zero for a book that only ever went up', () => {
    // The bug this catches: measuring peak to peak rather than peak to recovery. Every pair of
    // consecutive highs is a gap in time, and counting those reported a drawdown for an
    // account that never had one.
    const curve = equityCurve(
      [onDay('2026-07-01', 100), onDay('2026-08-02', 100), onDay('2026-09-03', 100)],
      1000,
    );
    const result = underwater(curve, 1000);
    expect(result.longestDays).toBe(0);
    expect(result.ongoing).toBe(false);
    expect(result.from).toBeNull();
  });

  it('measures from the peak it fell from, not from the trough', () => {
    // Peak on the 1st, down on the 5th, back above on the 11th: ten days under water,
    // not the six from the trough.
    const curve = equityCurve(
      [
        onDay('2026-07-01', 100),
        onDay('2026-07-05', -50),
        onDay('2026-07-11', 200),
      ],
      1000,
    );
    const result = underwater(curve, 1000);
    expect(result.longestDays).toBe(10);
    expect(result.from?.toISOString()).toContain('2026-07-01');
    expect(result.recoveredAt?.toISOString()).toContain('2026-07-11');
    expect(result.ongoing).toBe(false);
  });

  it('keeps the longest spell, not the most recent one', () => {
    const curve = equityCurve(
      [
        onDay('2026-01-01', 100),
        onDay('2026-01-05', -50),
        onDay('2026-03-01', 200), // ~59 days under water
        onDay('2026-03-02', -10),
        onDay('2026-03-05', 100), // 4 days under water
      ],
      1000,
    );
    const result = underwater(curve, 1000);
    expect(result.longestDays).toBeGreaterThan(50);
  });

  it('counts a spell that has not ended, and can report it as the longest', () => {
    // The failure this exists to prevent: telling someone who has been under water for seven
    // months that their longest drawdown was four days, because only recoveries were counted.
    const curve = equityCurve(
      [
        onDay('2026-01-01', 100),
        onDay('2026-01-03', -20),
        onDay('2026-01-05', 30), // brief spell, recovered in 4 days
        onDay('2026-01-06', -500),
        onDay('2026-08-01', 10), // still far below the peak
      ],
      1000,
    );
    const result = underwater(curve, 1000);
    expect(result.ongoing).toBe(true);
    expect(result.ongoingDays).toBeGreaterThan(200);
    expect(result.longestDays).toBe(result.ongoingDays);
    expect(result.recoveredAt).toBeNull();
  });

  it('treats regaining the exact peak as recovered', () => {
    const curve = equityCurve(
      [onDay('2026-07-01', 100), onDay('2026-07-02', -100), onDay('2026-07-04', 100)],
      1000,
    );
    expect(underwater(curve, 1000).ongoing).toBe(false);
  });

  it('starts under water when the very first trade loses', () => {
    // The opening balance is a peak with no date, so the stretch is measured from the first
    // point in the window — an under-report, and better than the zero a missing date would
    // otherwise give someone who never recovered their deposit.
    const curve = equityCurve([onDay('2026-07-01', -100), onDay('2026-07-20', -50)], 1000);
    const result = underwater(curve, 1000);
    expect(result.ongoing).toBe(true);
    expect(result.ongoingDays).toBe(19);
    expect(result.longestDays).toBe(19);
  });
});

describe('dayLoads', () => {
  it('groups days by how many trades were closed on them', () => {
    const loads = dayLoads([
      onDay('2026-07-01', 100),
      onDay('2026-07-02', 50),
      onDay('2026-07-02', 50),
      onDay('2026-07-03', -10),
      onDay('2026-07-03', -10),
    ]);

    expect(loads.map((l) => l.trades)).toEqual([1, 2]);
    expect(loads.find((l) => l.trades === 1)!.days).toBe(1);
    expect(loads.find((l) => l.trades === 2)!.days).toBe(2);
  });

  it('averages over days, not over trades', () => {
    // Two 2-trade days making 100 and -20: the average 2-trade day makes 40, not 20.
    const loads = dayLoads([
      onDay('2026-07-01', 60),
      onDay('2026-07-01', 40),
      onDay('2026-07-02', -10),
      onDay('2026-07-02', -10),
    ]);
    const twos = loads.find((l) => l.trades === 2)!;
    expect(twos.net).toBe(80);
    expect(twos.avgNet).toBe(40);
  });

  it('shows the overtrading shape it exists to show', () => {
    const loads = dayLoads([
      // Two disciplined one-trade days.
      onDay('2026-07-01', 200),
      onDay('2026-07-02', 150),
      // One six-trade day that gave it all back.
      ...Array.from({ length: 6 }, (_, i) => onDay('2026-07-03', i === 0 ? 100 : -80)),
    ]);

    const quiet = loads.find((l) => l.trades === 1)!;
    const busy = loads.find((l) => l.trades === 6)!;
    expect(quiet.avgNet).toBe(175);
    expect(busy.avgNet).toBeLessThan(0);
  });

  it('reports the win rate over trades, not over days', () => {
    const loads = dayLoads([
      onDay('2026-07-01', 10),
      onDay('2026-07-01', -10),
      onDay('2026-07-02', 10),
      onDay('2026-07-02', 10),
    ]);
    const twos = loads.find((l) => l.trades === 2)!;
    expect(twos.wins).toBe(3);
    expect(twos.winRate).toBe(75);
  });

  it('is ordered by load, so the chart reads left to right', () => {
    const loads = dayLoads([
      ...Array.from({ length: 3 }, () => onDay('2026-07-03', 1)),
      onDay('2026-07-01', 1),
      ...Array.from({ length: 2 }, () => onDay('2026-07-02', 1)),
    ]);
    expect(loads.map((l) => l.trades)).toEqual([1, 2, 3]);
  });
});
