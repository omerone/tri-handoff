/**
 * Wall-clock ↔ instant conversion in a fixed IANA zone, with no dependency on the host's
 * own timezone.
 *
 * Every timestamp TRi stores is a UTC instant (that is what MT5 and MetaApi hand over), but
 * every analytics dimension the spec asks for is a *wall-clock* question: which weekday was
 * this, which session, which square on the calendar. Answering those with `Date#getHours()`
 * would make the numbers depend on the timezone of whatever machine happens to be rendering
 * them — the dashboard would disagree with itself between the server and the browser, and a
 * trade at 00:30 would move between two calendar days.
 *
 * Implemented with `Intl.DateTimeFormat` rather than a date library: it is the only thing in
 * the platform that actually knows the DST history of a zone, and it costs no dependency.
 */

/**
 * The zone every analytics dimension is expressed in.
 *
 * SPEC §3.5 defines the sessions as Asia / London / New York, and the prototype's hour
 * boundaries (< 9 Asia, < 16 London, else New York) are those sessions as an Israeli trader
 * reads them off their own clock — which is who this was built for. Keeping that as the
 * default reproduces the prototype exactly.
 *
 * OPEN QUESTION for the client: a trader who moves, or one whose broker server sits in a
 * different zone, would want this configurable. It is deliberately one constant so that
 * turning it into a user setting later is a one-line change plus a column.
 */
export const ANALYTICS_TIME_ZONE = 'Asia/Jerusalem';

export type WallClock = {
  year: number;
  /** 1–12, not the 0-based month of the Date API. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday, matching Date#getDay() and the prototype's weekday arrays. */
  weekday: number;
};

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = partsFormatter.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatter.set(timeZone, cached);
  }
  return cached;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The wall-clock reading of an instant in `timeZone`. */
export function wallClock(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): WallClock {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** The zone's UTC offset in milliseconds at a given instant (positive east of Greenwich). */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(instant);
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    num('hour'),
    num('minute'),
    num('second'),
  );
  // Compared against the instant truncated to whole seconds, because the formatted reading
  // has no millisecond component to compare with.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads the given wall-clock time.
 *
 * Two passes: the first guesses using the offset that applies at the UTC-interpreted time,
 * the second re-reads the offset at that guess. That converges for every real zone, and it
 * matters twice a year — on a DST boundary the offset before and after the guess differ, and
 * a single pass lands an hour out.
 *
 * Times inside a spring-forward gap do not exist; this returns the instant the clock jumps
 * to, which is the only sensible answer.
 */
export function fromWallClock(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone: string = ANALYTICS_TIME_ZONE,
): Date {
  const target = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    0,
    0,
  );

  let instant = target - offsetAt(new Date(target), timeZone);
  instant = target - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

/** True when both instants land on the same calendar day in `timeZone`. */
export function sameZonedDay(a: Date, b: Date, timeZone: string = ANALYTICS_TIME_ZONE): boolean {
  const x = wallClock(a, timeZone);
  const y = wallClock(b, timeZone);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** `YYYY-MM-DD` in `timeZone` — the key the calendar view groups by. */
export function zonedDateKey(instant: Date, timeZone: string = ANALYTICS_TIME_ZONE): string {
  const w = wallClock(instant, timeZone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

export type Session = 'asia' | 'london' | 'ny';

/**
 * Trading session from the wall-clock hour, using the prototype's boundaries.
 * Documented in ANALYTICS_TIME_ZONE above: these are the sessions as read off an Israeli
 * clock, which is why the zone and the boundaries have to move together.
 */
export function sessionOfHour(hour: number): Session {
  if (hour < 9) return 'asia';
  if (hour < 16) return 'london';
  return 'ny';
}
