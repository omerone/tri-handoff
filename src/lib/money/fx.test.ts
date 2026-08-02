import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The FX fallback ladder.
 *
 * Every currency figure in the product — the dashboard, total wealth, the long-positions
 * roll-up — goes through `getFxRate`, and a wrong branch here does not throw. It returns a
 * number, and the number is wrong by whatever the rate is wrong by. So each rung is tested
 * for what it returns *and* for what it does not do: the cache hit must not spend a request,
 * the failure path must not persist a rate it never received, and the bottom of the ladder
 * must produce NaN rather than 1:1, because 1:1 is a plausible-looking lie.
 *
 * The database and the network are the only things doubled; the rest is the real module.
 */

const db = vi.hoisted(() => ({
  readRecentRate: vi.fn(),
  readNewestRate: vi.fn(),
  writeCachedRate: vi.fn(),
}));

vi.mock('@/lib/db/fx', () => db);

const { convert, getFxRate, hasRate } = await import('./fx');

const fetchMock = vi.fn();

/** A Frankfurter-shaped 200. */
function rateResponse(quote: string, rate: number, date = '2026-08-02') {
  return { ok: true, json: async () => ({ date, rates: { [quote]: rate } }) };
}

beforeEach(() => {
  db.readRecentRate.mockReset().mockResolvedValue(null);
  db.readNewestRate.mockReset().mockResolvedValue(null);
  db.writeCachedRate.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // The unreachable-API path logs a warning by design; it is not a test failure.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rung 1 — the same currency', () => {
  it('is 1:1 without a query or a request', async () => {
    const fx = await getFxRate('ILS', 'ILS');

    expect(fx).toMatchObject({ base: 'ILS', quote: 'ILS', rate: 1, stale: false });
    expect(db.readRecentRate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recognises the pair whatever case it arrives in', async () => {
    // Account currencies come from the broker and the display currency from a form; neither
    // is guaranteed to be upper case, and 'usd' → 'USD' must not look like a conversion.
    const fx = await getFxRate('usd', 'USD');
    expect(fx.rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('rung 2 — a recently published cached rate', () => {
  it('uses it and spends no request', async () => {
    const asOf = new Date('2026-08-02T00:00:00Z');
    db.readRecentRate.mockResolvedValue({ rate: 3.71, asOf, fetchedAt: asOf });

    const fx = await getFxRate('USD', 'ILS');

    expect(fx).toMatchObject({ base: 'USD', quote: 'ILS', rate: 3.71, stale: false });
    expect(fx.asOf).toEqual(asOf);
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing new arrived, so nothing should be written back.
    expect(db.writeCachedRate).not.toHaveBeenCalled();
  });

  it('normalises the codes before looking them up', async () => {
    // The cache is keyed on (base, quote, day). A lower-case lookup would miss every row and
    // silently turn a cache hit into a request per page view.
    await getFxRate('usd', 'ils');
    expect(db.readRecentRate).toHaveBeenCalledWith('USD', 'ILS', expect.any(Number));
  });
});

describe('rung 3 — fetching', () => {
  it('fetches the pair, stores it, and reports it as current', async () => {
    fetchMock.mockResolvedValue(rateResponse('ILS', 3.68, '2026-08-01'));

    const fx = await getFxRate('USD', 'ILS');

    expect(fx).toMatchObject({ rate: 3.68, stale: false });
    expect(fx.asOf).toEqual(new Date('2026-08-01T00:00:00Z'));

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('from=USD');
    expect(url).toContain('to=ILS');

    // Written through, so the next user of the day takes rung 2.
    expect(db.writeCachedRate).toHaveBeenCalledWith('USD', 'ILS', 3.68, fx.asOf);
  });

  it('never reaches for the stale rung when the fetch succeeds', async () => {
    fetchMock.mockResolvedValue(rateResponse('ILS', 3.68));
    await getFxRate('USD', 'ILS');
    expect(db.readNewestRate).not.toHaveBeenCalled();
  });

  describe('rejects a response it cannot trust', () => {
    const newest = { rate: 3.5, asOf: new Date('2026-07-20T00:00:00Z'), fetchedAt: new Date() };

    beforeEach(() => {
      db.readNewestRate.mockResolvedValue(newest);
    });

    it.each([
      ['a non-200', { ok: false, json: async () => ({}) }],
      ['a body without the quote', { ok: true, json: async () => ({ date: '2026-08-02', rates: {} }) }],
      ['a non-numeric rate', { ok: true, json: async () => ({ date: '2026-08-02', rates: { ILS: '3.7' } }) }],
      // A zero or negative rate would not error anywhere downstream — it would quietly zero
      // or invert every converted figure on the page.
      ['a zero rate', { ok: true, json: async () => ({ date: '2026-08-02', rates: { ILS: 0 } }) }],
      ['a negative rate', { ok: true, json: async () => ({ date: '2026-08-02', rates: { ILS: -3.7 } }) }],
      ['a NaN rate', { ok: true, json: async () => ({ date: '2026-08-02', rates: { ILS: Number.NaN } }) }],
    ])('falls through on %s', async (_label, response) => {
      fetchMock.mockResolvedValue(response);

      const fx = await getFxRate('USD', 'ILS');

      expect(fx.rate).toBe(3.5);
      expect(fx.stale).toBe(true);
      // The whole point of rejecting it: a rate we do not believe must not become tomorrow's
      // cache hit.
      expect(db.writeCachedRate).not.toHaveBeenCalled();
    });

    it('falls through when the request itself throws', async () => {
      fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
      const fx = await getFxRate('USD', 'ILS');
      expect(fx).toMatchObject({ rate: 3.5, stale: true });
    });
  });
});

describe('rung 4 — any cached rate, however old', () => {
  it('serves a months-old rate rather than nothing, and says it is stale', async () => {
    // A rate from the spring is off by a fraction of a percent. A dashboard that fails to
    // load is off by everything.
    const asOf = new Date('2026-03-14T00:00:00Z');
    db.readNewestRate.mockResolvedValue({ rate: 3.42, asOf, fetchedAt: asOf });
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    const fx = await getFxRate('USD', 'ILS');

    expect(fx).toMatchObject({ rate: 3.42, stale: true });
    // `asOf` is how the UI says *how* old, so it has to be the rate's own date.
    expect(fx.asOf).toEqual(asOf);
    expect(hasRate(fx)).toBe(true);
  });
});

describe('the bottom of the ladder — no rate at all', () => {
  beforeEach(() => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
  });

  it('is NaN, not 1', async () => {
    // 1:1 would render "₪18,935" for a $18,935 account and look entirely believable. NaN is
    // the signal the caller uses to render the source currency instead.
    const fx = await getFxRate('USD', 'ILS');

    expect(Number.isNaN(fx.rate)).toBe(true);
    expect(hasRate(fx)).toBe(false);
    expect(fx.stale).toBe(true);
  });

  it('leaves the amount alone rather than multiplying it by NaN', async () => {
    const fx = await getFxRate('USD', 'ILS');
    expect(convert(18_935, fx)).toBe(18_935);
  });

  it('writes nothing', async () => {
    await getFxRate('USD', 'ILS');
    expect(db.writeCachedRate).not.toHaveBeenCalled();
  });
});

describe('one rate per pair', () => {
  /**
   * `/finance` converts a shekel figure and a broker-currency figure on the same render, and
   * `/long` converts once per currency held. All of that rests on the rate being a function
   * of the pair — a lookup that ignored its arguments, or a request-level cache keyed on
   * anything less than both codes, would hand the same number to every call and the page
   * would look completely normal.
   */
  it('keeps distinct pairs distinct within one render', async () => {
    db.readRecentRate.mockImplementation(async (base: string, quote: string) => {
      const rates: Record<string, number> = { 'USD:ILS': 3.71, 'EUR:ILS': 4.02, 'ILS:ILS': 1 };
      const rate = rates[`${base}:${quote}`];
      return rate === undefined ? null : { rate, asOf: new Date(), fetchedAt: new Date() };
    });

    const [usd, eur, ils] = await Promise.all([
      getFxRate('USD', 'ILS'),
      getFxRate('EUR', 'ILS'),
      getFxRate('ILS', 'ILS'),
    ]);

    expect(usd.rate).toBe(3.71);
    expect(eur.rate).toBe(4.02);
    expect(ils.rate).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('convert', () => {
  it('multiplies by the rate when there is one', async () => {
    db.readRecentRate.mockResolvedValue({ rate: 3.71, asOf: new Date(), fetchedAt: new Date() });
    const fx = await getFxRate('USD', 'ILS');
    expect(convert(100, fx)).toBeCloseTo(371, 9);
  });

  it('is the identity for the same currency', async () => {
    expect(convert(1_234.56, await getFxRate('ILS', 'ILS'))).toBe(1_234.56);
  });
});
