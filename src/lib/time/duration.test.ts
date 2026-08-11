import { describe, expect, it } from 'vitest';
import { formatDuration, hoursToMinutes } from './format';

/**
 * The study ledger is entered in hours *and* minutes and read back the same way, which puts
 * two conversions between what somebody typed and what they see. What is worth pinning is
 * that the pair is lossless for a whole number of minutes — the ledger is summed, so a
 * fraction of a minute lost per entry becomes a visibly wrong total.
 */
describe('durations in hours and minutes', () => {
  it('writes the minutes beside the hours rather than as a decimal', () => {
    expect(formatDuration(95, 'en')).toBe('1h 35m');
    expect(formatDuration(335, 'en')).toBe('5h 35m');
  });

  it('drops the minutes when there are none', () => {
    // "2h 0m" is noise; the whole point of the pair is that it reads like speech.
    expect(formatDuration(120, 'en')).toBe('2h');
  });

  it('says under an hour in minutes alone', () => {
    expect(formatDuration(35, 'en')).toBe('35m');
    expect(formatDuration(0, 'en')).toBe('0m');
  });

  it('speaks Hebrew in Hebrew', () => {
    // A bare `m` in a Hebrew sentence is an English abbreviation nobody chose.
    expect(formatDuration(95, 'he')).toBe("1 שע׳ 35 דק׳");
    expect(formatDuration(35, 'he')).toBe("35 דק׳");
  });

  /*
   * The reason the column was widened from two decimal places to four.
   *
   * 35 minutes is 0.58333… hours and is never exact in decimal, so the question is only
   * whether the stored value rounds back to the minute it came from — and whether it still
   * does once forty of them are added together. At two places it did not: forty sessions of
   * 35 minutes came back as 1,392 minutes instead of 1,400.
   */
  it('round-trips a whole number of minutes through the stored hours', () => {
    for (let minutes = 1; minutes <= 60 * 12; minutes++) {
      const stored = Math.round((minutes / 60) * 10_000) / 10_000;
      expect(hoursToMinutes(stored), `${minutes} minutes`).toBe(minutes);
    }
  });

  it('does not drift when many entries are summed', () => {
    const stored = Math.round((35 / 60) * 10_000) / 10_000;
    const total = Array.from({ length: 40 }, () => stored).reduce((sum, one) => sum + one, 0);
    expect(hoursToMinutes(total)).toBe(40 * 35);
    expect(formatDuration(hoursToMinutes(total), 'en')).toBe('23h 20m');
  });
});

describe('how far the largest unit goes', () => {
  it('rolls a hold time up into days', () => {
    // Fifty hours holding a swing position is "2d 2h"; the minutes stopped mattering.
    expect(formatDuration(50 * 60, 'en')).toBe('2d 2h');
  });

  it('keeps a study total in hours and minutes however large it gets', () => {
    // Nobody says they studied for two days, and rolling up would drop the minutes — which
    // is the one thing the ledger was asked to show.
    expect(formatDuration(52 * 60 + 20, 'en', { maxUnit: 'hour' })).toBe('52h 20m');
    expect(formatDuration(52 * 60 + 20, 'he', { maxUnit: 'hour' })).toBe("52 שע׳ 20 דק׳");
  });
});

describe('Hebrew durations read as Hebrew', () => {
  /**
   * The study ledger's tiles rendered "1ש39דק׳" — one unbroken smear. Digits run
   * left-to-right inside a right-to-left line, so with nothing between the runs the reader
   * has to work out where each figure starts, and `ש` on its own is a letter rather than the
   * abbreviation for שעות. Both halves of that are pinned here.
   */
  const GERESH = '׳';

  it('puts a space between every figure and its unit', () => {
    expect(formatDuration(99, 'he')).toBe(`1 שע${GERESH} 39 דק${GERESH}`);
    // No digit may touch a Hebrew letter anywhere in the output.
    expect(formatDuration(99, 'he')).not.toMatch(/\d[֐-׿]/u);
    expect(formatDuration(3 * 24 * 60 + 120, 'he')).not.toMatch(/\d[֐-׿]/u);
  });

  it('abbreviates with a geresh, not a bare letter or an ASCII apostrophe', () => {
    const text = formatDuration(3 * 24 * 60 + 120, 'he');
    expect(text).toBe(`3 ימ${GERESH} 2 שע${GERESH}`);
    expect(text, 'an ASCII apostrophe a font may curl into a quote').not.toContain("'");
  });

  it('leaves English tight, because "1h 39m" is how English writes it', () => {
    expect(formatDuration(99, 'en')).toBe('1h 39m');
  });
});
