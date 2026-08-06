import { describe, expect, it } from 'vitest';
import { holdTimes, streaks } from './streaks';
import type { AnalyticsTrade } from './types';

let seq = 0;
const trade = (profit: number, heldMinutes = 60): AnalyticsTrade => {
  seq += 1;
  const openAt = new Date(Date.UTC(2026, 6, 1, 9, 0) + seq * 86_400_000);
  return {
    id: `t${seq}`,
    symbol: 'EURUSD',
    assetClass: 'forex',
    direction: 'long',
    style: 'day',
    openAt,
    closeAt: new Date(openAt.getTime() + heldMinutes * 60_000),
    profit,
    risk: null,
    rr: null,
    strategy: null,
    rating: null,
    mood: null,
    tpTiming: null,
    tookOriginalTp: null,
  };
};

describe('streaks', () => {
  it('finds the longest run on each side', () => {
    const result = streaks([
      trade(100), trade(100), trade(100),
      trade(-50),
      trade(100),
      trade(-50), trade(-50), trade(-50), trade(-50),
    ]);

    expect(result.longestWin).toBe(3);
    expect(result.longestLoss).toBe(4);
  });

  it('signs the current run so "where am I now" is one number', () => {
    expect(streaks([trade(100), trade(-50), trade(-50)]).current).toBe(-2);
    expect(streaks([trade(-50), trade(100), trade(100)]).current).toBe(2);
  });

  it('separates runs that a profit factor cannot', () => {
    // Same eight wins and four losses either way. Spread out, then all in a row.
    const spread = [
      trade(100), trade(-50), trade(100), trade(-50),
      trade(100), trade(-50), trade(100), trade(-50),
      trade(100), trade(100), trade(100), trade(100),
    ];
    const clustered = [
      trade(100), trade(100), trade(100), trade(100),
      trade(100), trade(100), trade(100), trade(100),
      trade(-50), trade(-50), trade(-50), trade(-50),
    ];

    expect(streaks(spread).longestLoss).toBe(1);
    expect(streaks(clustered).longestLoss).toBe(4);
  });

  it('treats a break-even trade as neither, ending the run without starting one', () => {
    const result = streaks([trade(100), trade(100), trade(0), trade(100)]);

    expect(result.longestWin).toBe(2);
    expect(result.longestLoss).toBe(0);
    expect(result.current).toBe(1);
  });

  it('holds no opinion about an empty window', () => {
    expect(streaks([])).toEqual({ longestWin: 0, longestLoss: 0, current: 0 });
  });
});

describe('hold times', () => {
  it('averages each side separately', () => {
    const result = holdTimes([
      trade(100, 20), trade(100, 40),
      trade(-50, 300), trade(-50, 500),
    ]);

    expect(result.winners).toBe(30);
    expect(result.losers).toBe(400);
  });

  it('reports the asymmetry as a ratio below one', () => {
    // Twenty minutes on winners, two days on losers — the habit this exists to expose.
    const result = holdTimes([trade(100, 20), trade(-50, 2_880)]);

    expect(result.ratio).toBeCloseTo(20 / 2_880);
    expect(result.ratio! < 1).toBe(true);
  });

  it('withholds the ratio when one side is missing', () => {
    expect(holdTimes([trade(100, 30), trade(100, 50)]).ratio).toBeNull();
    expect(holdTimes([trade(-50, 30)]).ratio).toBeNull();
  });

  it('leaves break-even trades out of both means', () => {
    // A ten-hour scratch would drag whichever side it landed in.
    const withScratch = holdTimes([trade(100, 20), trade(0, 600), trade(-50, 40)]);

    expect(withScratch.winners).toBe(20);
    expect(withScratch.losers).toBe(40);
  });

  it('skips a close stamped before its open rather than counting it as zero', () => {
    const backwards = trade(100, -120);
    const result = holdTimes([trade(100, 60), backwards]);

    expect(result.winners).toBe(60);
  });

  it('holds no opinion about an empty window', () => {
    expect(holdTimes([])).toEqual({ winners: null, losers: null, ratio: null });
  });
});
