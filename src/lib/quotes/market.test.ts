import { describe, expect, it } from 'vitest';
import {
  assetKind,
  CRYPTO_MAX_AGE_MS,
  isMarketOpen,
  isQuoteStale,
  lastMarketClose,
  MIN_REFETCH_MS,
  needsRefresh,
} from './market';

/**
 * The cost model, tested at its edges.
 *
 * Every case here is one where getting it wrong costs either money — a refresh loop against a
 * metered API — or trust: a price that stops updating without saying so. The dates are real
 * instants in New York, because "is this stale" is a question about a market's clock and the
 * two-a-year offset change is exactly where a naive answer breaks.
 */

/** 2026-08-03 is a Monday. Times are UTC; New York is UTC−4 in August. */
const MON_1000_ET = new Date('2026-08-03T14:00:00Z');
const MON_1600_ET = new Date('2026-08-03T20:00:00Z');
const MON_2300_ET = new Date('2026-08-04T03:00:00Z');
const FRI_1600_ET = new Date('2026-07-31T20:00:00Z');
const SAT_1200_ET = new Date('2026-08-01T16:00:00Z');
const SUN_2000_ET = new Date('2026-08-02T00:00:00Z');

const ago = (from: Date, ms: number) => new Date(from.getTime() - ms);

describe('asset kind', () => {
  it('reads a slash as a crypto pair and anything else as a listing', () => {
    expect(assetKind('BTC/USD')).toBe('crypto');
    expect(assetKind('AAPL')).toBe('equity');
    // A ticker with a dot is still an equity — only the pair notation uses a slash.
    expect(assetKind('BRK.B')).toBe('equity');
  });
});

describe('last market close', () => {
  it('is today once the bell has gone', () => {
    expect(lastMarketClose(MON_2300_ET).toISOString()).toBe(MON_1600_ET.toISOString());
  });

  it('is the previous session while the market is still trading', () => {
    expect(lastMarketClose(MON_1000_ET).toISOString()).toBe(FRI_1600_ET.toISOString());
  });

  it('skips the weekend rather than inventing a Saturday close', () => {
    expect(lastMarketClose(SAT_1200_ET).toISOString()).toBe(FRI_1600_ET.toISOString());
    expect(lastMarketClose(SUN_2000_ET).toISOString()).toBe(FRI_1600_ET.toISOString());
  });

  it('lands on the right hour on both sides of the daylight-saving switch', () => {
    // The clocks go back on 2026-11-01. A fixed UTC offset would put one of these an hour
    // out, and an hour is the whole difference between "fresh" and a needless refresh.
    const beforeDst = lastMarketClose(new Date('2026-10-30T23:00:00Z')); // Fri, UTC−4
    const afterDst = lastMarketClose(new Date('2026-11-03T23:00:00Z')); // Tue, UTC−5
    expect(beforeDst.toISOString()).toBe('2026-10-30T20:00:00.000Z');
    expect(afterDst.toISOString()).toBe('2026-11-03T21:00:00.000Z');
  });
});

describe('market open', () => {
  it('opens at half past nine and closes at four, on weekdays only', () => {
    expect(isMarketOpen(MON_1000_ET)).toBe(true);
    expect(isMarketOpen(new Date('2026-08-03T13:29:00Z'))).toBe(false); // 09:29
    expect(isMarketOpen(new Date('2026-08-03T13:31:00Z'))).toBe(true); // 09:31
    expect(isMarketOpen(MON_1600_ET)).toBe(false); // the close itself is not open
    expect(isMarketOpen(SAT_1200_ET)).toBe(false);
  });
});

describe('needs refresh', () => {
  it('fetches a listing nothing is known about', () => {
    expect(needsRefresh(null, 'AAPL', MON_2300_ET)).toBe(true);
  });

  it('holds off on anything asked about in the last hour, however stale it looks', () => {
    const cached = { asOf: new Date('2020-01-01T00:00:00Z'), fetchedAt: ago(MON_2300_ET, 60_000) };
    expect(needsRefresh(cached, 'AAPL', MON_2300_ET)).toBe(false);
  });

  it('asks again after the close, once, and not before', () => {
    const fridayClose = { asOf: FRI_1600_ET, fetchedAt: ago(MON_1000_ET, MIN_REFETCH_MS * 2) };
    // Monday morning: Friday's close is still the last price the market produced.
    expect(needsRefresh(fridayClose, 'AAPL', MON_1000_ET)).toBe(false);
    // Monday evening: there is a new close to fetch.
    expect(needsRefresh(fridayClose, 'AAPL', MON_2300_ET)).toBe(true);
    // And once it has been fetched, nothing more until tomorrow's.
    const mondayClose = { asOf: MON_1600_ET, fetchedAt: ago(MON_2300_ET, MIN_REFETCH_MS * 2) };
    expect(needsRefresh(mondayClose, 'AAPL', MON_2300_ET)).toBe(false);
  });

  it('costs nothing over a weekend', () => {
    const cached = { asOf: FRI_1600_ET, fetchedAt: FRI_1600_ET };
    expect(needsRefresh(cached, 'AAPL', SAT_1200_ET)).toBe(false);
    expect(needsRefresh(cached, 'AAPL', SUN_2000_ET)).toBe(false);
    expect(needsRefresh(cached, 'AAPL', MON_1000_ET)).toBe(false);
  });

  it('backs a market holiday off to one attempt an hour instead of one a minute', () => {
    // The feed keeps answering with Friday's close on a Monday holiday, so `asOf` never
    // catches up. Without the floor this would be due on every single tick.
    const holiday = { asOf: FRI_1600_ET, fetchedAt: ago(MON_2300_ET, 5 * 60_000) };
    expect(needsRefresh(holiday, 'AAPL', MON_2300_ET)).toBe(false);

    const anHourLater = { asOf: FRI_1600_ET, fetchedAt: ago(MON_2300_ET, MIN_REFETCH_MS + 1000) };
    expect(needsRefresh(anHourLater, 'AAPL', MON_2300_ET)).toBe(true);
  });

  it('retries a listing the provider had nothing for, but only at the back-off', () => {
    const missed = { asOf: null, fetchedAt: ago(MON_2300_ET, 60_000) };
    expect(needsRefresh(missed, 'NOPE', MON_2300_ET)).toBe(false);

    const older = { asOf: null, fetchedAt: ago(MON_2300_ET, MIN_REFETCH_MS + 1000) };
    expect(needsRefresh(older, 'NOPE', MON_2300_ET)).toBe(true);
  });

  it('ages crypto by the clock, since it has no close to wait for', () => {
    const fresh = {
      asOf: ago(SAT_1200_ET, CRYPTO_MAX_AGE_MS - 60_000),
      fetchedAt: ago(SAT_1200_ET, MIN_REFETCH_MS * 2),
    };
    expect(needsRefresh(fresh, 'BTC/USD', SAT_1200_ET)).toBe(false);

    const old = {
      asOf: ago(SAT_1200_ET, CRYPTO_MAX_AGE_MS + 60_000),
      fetchedAt: ago(SAT_1200_ET, MIN_REFETCH_MS * 2),
    };
    // A Saturday, when an equity would not be fetched at all.
    expect(needsRefresh(old, 'BTC/USD', SAT_1200_ET)).toBe(true);
  });
});

describe('stale quote warning', () => {
  it('does not call a Friday close stale on a Sunday', () => {
    expect(isQuoteStale({ asOf: FRI_1600_ET, fetchedAt: FRI_1600_ET }, 'AAPL', SUN_2000_ET)).toBe(
      false,
    );
  });

  it('calls a price stale once a whole trading day has passed without one', () => {
    const twoSessionsBack = new Date('2026-07-29T20:00:00Z'); // Wednesday's close
    expect(
      isQuoteStale({ asOf: twoSessionsBack, fetchedAt: twoSessionsBack }, 'AAPL', MON_2300_ET),
    ).toBe(true);
  });

  it('treats a listing that never answered as stale', () => {
    expect(isQuoteStale({ asOf: null, fetchedAt: MON_2300_ET }, 'AAPL', MON_2300_ET)).toBe(true);
  });
});
