import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwelveDataProvider } from './provider';

/**
 * The vendor's wire format, against real response shapes.
 *
 * Everything here was copied from an actual call rather than invented, because the shapes are
 * where this breaks: a single symbol answers flat while several answer keyed by symbol, one
 * bad ticker in a batch comes back as an error object *beside* the good ones, and the price's
 * own timestamp arrives in two different forms depending on the bar.
 */

const stubFetch = (body: unknown, ok = true) => {
  // The parameter is declared even though the stub ignores it: without it the mock's call
  // tuple is empty, and asserting on the URL that was requested is a type error.
  const fetchMock = vi.fn(
    async (_input?: unknown) => ({ ok, json: async () => body }) as unknown as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => vi.unstubAllGlobals());

describe('quotes', () => {
  it('reads a single symbol, which comes back flat', async () => {
    stubFetch({
      symbol: 'AAPL',
      mic_code: 'XNGS',
      currency: 'USD',
      close: '308.91000',
      timestamp: 1785504600,
    });

    const quotes = await new TwelveDataProvider('key').fetchQuotes([
      { symbol: 'AAPL', micCode: 'XNGS' },
    ]);

    expect(quotes).toEqual([
      {
        symbol: 'AAPL',
        micCode: 'XNGS',
        price: 308.91,
        currency: 'USD',
        asOf: new Date(1785504600 * 1000),
      },
    ]);
  });

  it('reads a batch, which comes back keyed by symbol, in one request', async () => {
    const fetchMock = stubFetch({
      AAPL: { symbol: 'AAPL', mic_code: 'XNGS', currency: 'USD', close: '308.91', timestamp: 1785504600 },
      QQQ: { symbol: 'QQQ', mic_code: 'XNMS', currency: 'USD', close: '688.01', timestamp: 1785504600 },
    });

    const quotes = await new TwelveDataProvider('key').fetchQuotes([
      { symbol: 'AAPL', micCode: 'XNGS' },
      { symbol: 'QQQ', micCode: 'XNMS' },
    ]);

    expect(quotes.map((q) => q.price)).toEqual([308.91, 688.01]);
    // One round trip for the whole chunk — the credit cost is per symbol either way, but the
    // per-minute meter is what the chunking is sized against.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the good half of a batch when the vendor rejects one symbol', async () => {
    stubFetch({
      AAPL: { symbol: 'AAPL', mic_code: 'XNGS', currency: 'USD', close: '308.91', timestamp: 1 },
      NOPE: { code: 404, message: 'symbol not found', status: 'error' },
    });

    const quotes = await new TwelveDataProvider('key').fetchQuotes([
      { symbol: 'AAPL', micCode: 'XNGS' },
      { symbol: 'NOPE', micCode: 'XNGS' },
    ]);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.symbol).toBe('AAPL');
  });

  it('matches a position that carries no MIC to the primary listing', async () => {
    // Every position created before the search box existed is in this state, as is every
    // crypto pair — which is not listed on an exchange at all.
    stubFetch({ symbol: 'AAPL', mic_code: 'XNGS', currency: 'USD', close: '308.91', timestamp: 1 });

    const quotes = await new TwelveDataProvider('key').fetchQuotes([
      { symbol: 'AAPL', micCode: '' },
    ]);

    expect(quotes[0]?.price).toBe(308.91);
    // Echoed back under the key that was asked for, so it lands on the right cache row.
    expect(quotes[0]?.micCode).toBe('');
  });

  it('places a daily bar at the close rather than at midnight', async () => {
    // `datetime` on a daily bar is a bare date. Parsed as midnight UTC it would sit *before*
    // the close it stands for, and the refresh would immediately believe itself owed another.
    stubFetch({ symbol: 'AAPL', mic_code: 'XNGS', currency: 'USD', close: '308.91', datetime: '2026-07-31' });

    const quotes = await new TwelveDataProvider('key').fetchQuotes([
      { symbol: 'AAPL', micCode: 'XNGS' },
    ]);

    expect(quotes[0]?.asOf.toISOString()).toBe('2026-07-31T20:00:00.000Z');
  });

  it('drops a row with no usable price rather than storing a zero', async () => {
    stubFetch({ symbol: 'AAPL', mic_code: 'XNGS', currency: 'USD', close: 'n/a', timestamp: 1 });

    expect(
      await new TwelveDataProvider('key').fetchQuotes([{ symbol: 'AAPL', micCode: 'XNGS' }]),
    ).toEqual([]);
  });

  it('asks for nothing at all without an API key', async () => {
    const fetchMock = stubFetch({});
    expect(
      await new TwelveDataProvider('').fetchQuotes([{ symbol: 'AAPL', micCode: 'XNGS' }]),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns nothing, rather than throwing, when the feed is down', async () => {
    stubFetch({ message: 'nope' }, false);
    expect(
      await new TwelveDataProvider('key').fetchQuotes([{ symbol: 'AAPL', micCode: 'XNGS' }]),
    ).toEqual([]);
  });
});

describe('search', () => {
  it('needs no API key, so the form works before a vendor account exists', async () => {
    const fetchMock = stubFetch({
      data: [
        {
          symbol: 'AAPL',
          instrument_name: 'Apple Inc.',
          exchange: 'NASDAQ',
          mic_code: 'XNGS',
          currency: 'USD',
        },
      ],
    });

    const results = await new TwelveDataProvider('').search('apple', 5);

    expect(results).toEqual([
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        exchange: 'NASDAQ',
        micCode: 'XNGS',
        currency: 'USD',
        kind: 'equity',
      },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('apikey');
  });

  it('drops a listing with no currency, which nothing could ever price', async () => {
    stubFetch({ data: [{ symbol: 'X', instrument_name: 'Mystery', exchange: 'NOWHERE' }] });
    expect(await new TwelveDataProvider('').search('mystery', 5)).toEqual([]);
  });

  it('reads a pair as crypto', async () => {
    stubFetch({
      data: [{ symbol: 'BTC/USD', instrument_name: 'Bitcoin', exchange: 'Coinbase Pro', currency: 'USD' }],
    });
    const [match] = await new TwelveDataProvider('').search('bitcoin', 5);
    expect(match?.kind).toBe('crypto');
    expect(match?.micCode).toBe('');
  });
});
