import { describe, expect, it } from 'vitest';
import { isAutoSyncDue, staleHours, STALE_AFTER_HOURS } from './status';

const NOW = new Date('2026-08-06T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const inputs = (over: Partial<Parameters<typeof isAutoSyncDue>[0]> = {}) => ({
  lastSyncAt: hoursAgo(1),
  connected: true,
  lastLoginAt: hoursAgo(2),
  autoSyncOnLogin: true,
  now: NOW,
  ...over,
});

describe('isAutoSyncDue', () => {
  it('is false whenever the setting is off, whatever else is true', () => {
    /*
     * The whole cost saving in one assertion. Every other input below is the one that would
     * otherwise fire a sync — a fresh login, an account never synced, no account at all —
     * and none of them may spend anything while the setting is off.
     */
    const cases = [
      { lastSyncAt: null },
      { lastLoginAt: NOW, lastSyncAt: hoursAgo(5) },
      { lastLoginAt: null },
      { connected: false },
    ];
    for (const over of cases) {
      expect(isAutoSyncDue(inputs({ ...over, autoSyncOnLogin: false }))).toBe(false);
    }
  });

  it('is false with no broker account, even with the setting on', () => {
    expect(isAutoSyncDue(inputs({ connected: false }))).toBe(false);
    expect(isAutoSyncDue(inputs({ connected: false, lastSyncAt: null }))).toBe(false);
  });

  it('is true for an account that has never synced', () => {
    // A freshly connected account has a whole history waiting; there is no "since" to resume
    // from and nothing to compare a login against.
    expect(isAutoSyncDue(inputs({ lastSyncAt: null }))).toBe(true);
    expect(isAutoSyncDue(inputs({ lastSyncAt: null, lastLoginAt: null }))).toBe(true);
  });

  it('is true once after a login, and false for every navigation after it', () => {
    // Signed in at 10:00, last sync at 11:00 → the login has been served already.
    expect(isAutoSyncDue(inputs({ lastLoginAt: hoursAgo(2), lastSyncAt: hoursAgo(1) }))).toBe(
      false,
    );
    // Signed in at 11:00, last sync at 10:00 → this login has not been served yet.
    expect(isAutoSyncDue(inputs({ lastLoginAt: hoursAgo(1), lastSyncAt: hoursAgo(2) }))).toBe(true);
  });

  it('is false when the two stamps are identical', () => {
    // Strictly greater, so the sync that answered a login cannot re-trigger it.
    const at = hoursAgo(1);
    expect(isAutoSyncDue(inputs({ lastLoginAt: at, lastSyncAt: at }))).toBe(false);
  });

  it('is false when there is no login stamp to reason about', () => {
    // We cannot tell when the session began, and the safe direction for a question about
    // spending money is "do not".
    expect(isAutoSyncDue(inputs({ lastLoginAt: null }))).toBe(false);
  });
});

describe('staleHours', () => {
  it('says nothing until the threshold', () => {
    for (const h of [0, 1, STALE_AFTER_HOURS - 1]) {
      expect(staleHours({ lastSyncAt: hoursAgo(h), now: NOW })).toBeNull();
    }
  });

  it('reports the age from the threshold onwards', () => {
    expect(staleHours({ lastSyncAt: hoursAgo(STALE_AFTER_HOURS), now: NOW })).toBe(
      STALE_AFTER_HOURS,
    );
    expect(staleHours({ lastSyncAt: hoursAgo(38), now: NOW })).toBe(38);
  });

  it('rounds down, so "12h ago" never means eleven and a half', () => {
    const at = new Date(NOW.getTime() - (12 * 3_600_000 + 59 * 60_000));
    expect(staleHours({ lastSyncAt: at, now: NOW })).toBe(12);
  });

  it('says nothing when there has never been a sync', () => {
    // "Never synced" is its own message on the pill, and a clearer sentence than "0h ago".
    expect(staleHours({ lastSyncAt: null, now: NOW })).toBeNull();
  });

  it('reads a future timestamp as fresh rather than as a negative age', () => {
    // A server clock corrected backwards, or a row written by a machine running ahead.
    expect(staleHours({ lastSyncAt: new Date(NOW.getTime() + 3_600_000), now: NOW })).toBeNull();
  });
});
