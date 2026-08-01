import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_TIME_ZONE,
  fromWallClock,
  sameZonedDay,
  sessionOfHour,
  wallClock,
  zonedDateKey,
} from './zone';

/**
 * Every analytics dimension is a wall-clock question asked of a UTC instant. Getting the
 * conversion wrong does not throw — it moves trades between weekdays, between sessions and
 * between squares on the calendar, and the totals still add up, so nothing looks broken.
 *
 * The DST cases matter more than they look: Israel switches at the end of March and the end
 * of October, in the middle of the generated demo window.
 */

describe('wallClock', () => {
  it('reads an instant in the target zone, not the host zone', () => {
    // 06:30 UTC on a summer day is 09:30 in Jerusalem (UTC+3).
    const w = wallClock(new Date('2026-07-15T06:30:00Z'), 'Asia/Jerusalem');
    expect(w).toMatchObject({ year: 2026, month: 7, day: 15, hour: 9, minute: 30, weekday: 3 });
  });

  it('applies the winter offset', () => {
    // Same clock reading in January is UTC+2.
    const w = wallClock(new Date('2026-01-15T06:30:00Z'), 'Asia/Jerusalem');
    expect(w).toMatchObject({ hour: 8, minute: 30 });
  });

  it('rolls the date backwards when the zone is behind UTC', () => {
    const w = wallClock(new Date('2026-07-15T02:00:00Z'), 'America/New_York');
    expect(w).toMatchObject({ month: 7, day: 14, hour: 22 });
  });

  it('numbers weekdays from Sunday, like the calendar grid', () => {
    // 2026-07-05 is a Sunday.
    expect(wallClock(new Date('2026-07-05T12:00:00Z')).weekday).toBe(0);
    expect(wallClock(new Date('2026-07-06T12:00:00Z')).weekday).toBe(1);
    expect(wallClock(new Date('2026-07-11T12:00:00Z')).weekday).toBe(6);
  });
});

describe('fromWallClock', () => {
  it('round-trips with wallClock', () => {
    const cases = [
      { year: 2026, month: 7, day: 31, hour: 23, minute: 55 },
      { year: 2026, month: 1, day: 1, hour: 0, minute: 0 },
      { year: 2026, month: 12, day: 31, hour: 18, minute: 30 },
    ];

    for (const wall of cases) {
      const instant = fromWallClock(wall);
      expect(wallClock(instant)).toMatchObject(wall);
    }
  });

  it('resolves the correct offset on both sides of a DST change', () => {
    // Israel moves to UTC+3 on 2026-03-27 and back to UTC+2 on 2026-10-25.
    const beforeSpring = fromWallClock({ year: 2026, month: 3, day: 20, hour: 12 });
    const afterSpring = fromWallClock({ year: 2026, month: 4, day: 3, hour: 12 });

    expect(beforeSpring.toISOString()).toBe('2026-03-20T10:00:00.000Z');
    expect(afterSpring.toISOString()).toBe('2026-04-03T09:00:00.000Z');
  });

  it('round-trips every hour across a DST boundary without losing a day', () => {
    // A single-pass offset lookup lands an hour out here; the second pass is what fixes it.
    for (let hour = 0; hour < 24; hour++) {
      const wall = { year: 2026, month: 10, day: 25, hour, minute: 0 };
      const read = wallClock(fromWallClock(wall));
      expect(read.day).toBe(25);
      // 02:00 on a fall-back day happens twice; either reading is correct.
      if (hour !== 2) expect(read.hour).toBe(hour);
    }
  });

  it('defaults the time to midnight', () => {
    expect(wallClock(fromWallClock({ year: 2026, month: 7, day: 1 }))).toMatchObject({
      hour: 0,
      minute: 0,
    });
  });
});

describe('sameZonedDay', () => {
  it('is true across an hour boundary inside one day', () => {
    expect(
      sameZonedDay(new Date('2026-07-15T06:00:00Z'), new Date('2026-07-15T18:00:00Z')),
    ).toBe(true);
  });

  it('is false across midnight in the analytics zone, even within 24 hours', () => {
    // 21:30 and 22:30 UTC are 00:30 and 01:30 the *next* day in Jerusalem.
    expect(
      sameZonedDay(new Date('2026-07-15T20:00:00Z'), new Date('2026-07-15T21:30:00Z')),
    ).toBe(false);
  });
});

describe('zonedDateKey', () => {
  it('formats a zero-padded calendar key', () => {
    expect(zonedDateKey(new Date('2026-07-05T09:00:00Z'))).toBe('2026-07-05');
  });

  it("keys by the zone's calendar day, not UTC's", () => {
    // 22:00 UTC on the 5th is already the 6th in Jerusalem — the trade belongs on that square.
    expect(zonedDateKey(new Date('2026-07-05T22:00:00Z'))).toBe('2026-07-06');
  });
});

describe('sessionOfHour', () => {
  it('splits the day into the three sessions the spec names', () => {
    expect(sessionOfHour(0)).toBe('asia');
    expect(sessionOfHour(8)).toBe('asia');
    expect(sessionOfHour(9)).toBe('london');
    expect(sessionOfHour(15)).toBe('london');
    expect(sessionOfHour(16)).toBe('ny');
    expect(sessionOfHour(23)).toBe('ny');
  });

  it('covers every hour with exactly one session', () => {
    const seen = new Set<string>();
    for (let hour = 0; hour < 24; hour++) seen.add(sessionOfHour(hour));
    expect([...seen].sort()).toEqual(['asia', 'london', 'ny']);
  });
});

describe('configuration', () => {
  it('names the analytics zone in one place', () => {
    // Turning this into a per-user setting later should be a column plus this constant.
    expect(ANALYTICS_TIME_ZONE).toBe('Asia/Jerusalem');
  });
});
