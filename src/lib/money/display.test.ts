import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `displayMoney` is the join between "what currency is this number in" and "what currency
 * does the user read in". Every P1 page builds its `money()` from it, so the branch that
 * matters is the one nobody sees in development: what it does when there is no rate.
 *
 * The database and the network are doubled; `getFxRate` itself is the real one, so these
 * exercise the same ladder the pages get.
 */

const db = vi.hoisted(() => ({
  readRecentRate: vi.fn(),
  readNewestRate: vi.fn(),
  writeCachedRate: vi.fn(),
}));

vi.mock('@/lib/db/fx', () => db);

const { displayMoney } = await import('./display');

const fetchMock = vi.fn();

/** No rate anywhere and no network — the bottom of the ladder. */
function noRateAvailable() {
  db.readRecentRate.mockResolvedValue(null);
  db.readNewestRate.mockResolvedValue(null);
  fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
}

function cachedRate(rate: number, asOf = new Date('2026-08-02T00:00:00Z')) {
  db.readRecentRate.mockResolvedValue({ rate, asOf, fetchedAt: asOf });
}

beforeEach(() => {
  db.readRecentRate.mockReset().mockResolvedValue(null);
  db.readNewestRate.mockReset().mockResolvedValue(null);
  db.writeCachedRate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue({ ok: false, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('when the source and the display currency are the same', () => {
  it('formats without converting and without a request', async () => {
    const { money, currency, converted, stale, display } = await displayMoney({
      source: 'ILS',
      display: 'ILS',
      locale: 'en',
    });

    expect(money(1_234)).toBe('₪1,234');
    expect({ currency, converted, stale, rate: display.rate }).toEqual({
      currency: 'ILS',
      converted: true,
      stale: false,
      rate: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('when a rate is available', () => {
  beforeEach(() => cachedRate(0.27));

  it('converts and formats in the display currency', async () => {
    const { money, currency, converted } = await displayMoney({
      source: 'ILS',
      display: 'USD',
      locale: 'en',
    });

    expect(money(1_000)).toBe('$270');
    expect(currency).toBe('USD');
    expect(converted).toBe(true);
  });

  it('passes the formatting options through', async () => {
    const { money } = await displayMoney({ source: 'ILS', display: 'USD', locale: 'en' });

    expect(money(1_000, { signed: true })).toBe('+$270');
    expect(money(1_000, { decimals: 2 })).toBe('$270.00');
    expect(money(-1_000)).toBe('-$270');
  });

  it('hands the client half the same rate the server half used', async () => {
    // Charts format in the browser from `display`, KPI tiles format on the server from
    // `money`. If the two disagreed, an axis would contradict the tile above it.
    const { money, display } = await displayMoney({
      source: 'ILS',
      display: 'USD',
      locale: 'en',
    });
    const { formatDisplayMoney } = await import('./currency');

    expect(display.rate).toBe(0.27);
    expect(formatDisplayMoney(1_000, display)).toBe(money(1_000));
  });

  it('reports a stale rate as stale while still converting', async () => {
    db.readRecentRate.mockResolvedValue(null);
    db.readNewestRate.mockResolvedValue({
      rate: 0.25,
      asOf: new Date('2026-05-01T00:00:00Z'),
      fetchedAt: new Date('2026-05-01T00:00:00Z'),
    });

    const { money, converted, stale } = await displayMoney({
      source: 'ILS',
      display: 'USD',
      locale: 'en',
    });

    expect(stale).toBe(true);
    expect(converted).toBe(true);
    expect(money(1_000)).toBe('$250');
  });
});

describe('when there is no rate at all', () => {
  beforeEach(noRateAvailable);

  it('renders the source currency untouched rather than converting at 1:1', async () => {
    // An unexpected ₪ on a dashboard is a question. A shekel figure wearing a dollar sign is
    // a wrong number that nobody queries.
    const { money, currency, converted, stale } = await displayMoney({
      source: 'ILS',
      display: 'USD',
      locale: 'en',
    });

    expect(money(1_000)).toBe('₪1,000');
    expect(currency).toBe('ILS');
    expect(converted).toBe(false);
    expect(stale).toBe(true);
  });

  it('keeps the client half at 1 so a chart does not multiply by NaN', async () => {
    const { display } = await displayMoney({ source: 'ILS', display: 'USD', locale: 'en' });

    expect(display.rate).toBe(1);
    expect(display.currency).toBe('ILS');
  });

  it('still names the source currency, whatever the broker denominates in', async () => {
    // The account currency comes from MT5 and is not restricted to the four the user can
    // choose from, so callers that want to caption an unconverted figure have to read
    // `sourceCurrency` — `currency` is a display currency and cannot represent CHF.
    const { converted, sourceCurrency } = await displayMoney({
      source: 'chf',
      display: 'ILS',
      locale: 'en',
    });

    expect(converted).toBe(false);
    expect(sourceCurrency).toBe('CHF');
  });
});

describe('display-currency guard', () => {
  it('falls back to ILS for a currency the product does not support', async () => {
    // `displayCurrency` is a plain column; a stale row or a hand-edited value must not put an
    // undefined symbol in front of every number.
    cachedRate(3.71);
    const { currency, money } = await displayMoney({
      source: 'USD',
      display: 'XYZ',
      locale: 'en',
    });

    expect(currency).toBe('ILS');
    expect(money(100)).toBe('₪371');
    expect(db.readRecentRate).toHaveBeenCalledWith('USD', 'ILS', expect.any(Number));
  });
});
