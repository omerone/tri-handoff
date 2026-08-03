import { assetKind } from '../market';
import type { Quote, QuoteKey, QuoteProvider, SymbolMatch } from '../types';

/**
 * Twelve Data.
 *
 * Picked because one vendor covers all three things this portfolio holds — ordinary shares,
 * ETFs and crypto pairs — and because its symbol search matches company names, which is what
 * the add-position form needs. Batch quotes cost one credit per symbol but only one HTTP
 * round trip, so the refresh asks for its whole chunk at once.
 *
 * `search` is deliberately unauthenticated: the reference endpoint answers without a key, so
 * the form works on a deployment that has not been given one yet. Quotes do need the key, and
 * without it this returns nothing rather than throwing — a missing key must degrade to
 * "prices stay manual", not to a broken page.
 */

const BASE_URL = 'https://api.twelvedata.com';
const TIMEOUT_MS = 8_000;

type SearchRow = {
  symbol?: string;
  instrument_name?: string;
  exchange?: string;
  mic_code?: string;
  currency?: string;
};

type QuoteRow = {
  symbol?: string;
  mic_code?: string;
  currency?: string;
  close?: string;
  timestamp?: number;
  datetime?: string;
  /** Present instead of the fields above when the vendor rejects one symbol of a batch. */
  status?: string;
  code?: number;
};

export class TwelveDataProvider implements QuoteProvider {
  readonly name = 'twelvedata' as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<SymbolMatch[]> {
    const url = `${BASE_URL}/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=${limit * 3}`;
    const body = await this.get<{ data?: SearchRow[] }>(url, 'search');

    return (body?.data ?? [])
      .flatMap((row): SymbolMatch[] => {
        const symbol = row.symbol?.trim();
        const currency = row.currency?.trim();
        // A listing with no currency cannot be priced against a position, so it is not worth
        // offering — picking it would produce a holding nothing can ever mark to market.
        if (!symbol || !currency) return [];
        return [
          {
            symbol,
            name: row.instrument_name?.trim() || symbol,
            exchange: row.exchange?.trim() || '',
            micCode: row.mic_code?.trim() || '',
            currency,
            kind: assetKind(symbol),
          },
        ];
      })
      .slice(0, limit);
  }

  async fetchQuotes(keys: readonly QuoteKey[]): Promise<Quote[]> {
    if (keys.length === 0 || !this.apiKey) return [];

    // Deduplicated by ticker for the request, then matched back by (symbol, mic): the batch
    // response is keyed by symbol alone, so two listings of one ticker have to be told apart
    // on the way out.
    const symbols = [...new Set(keys.map((key) => key.symbol))];
    const url =
      `${BASE_URL}/quote?symbol=${encodeURIComponent(symbols.join(','))}` +
      `&apikey=${encodeURIComponent(this.apiKey)}`;

    const body = await this.get<Record<string, unknown>>(url, 'quote');
    if (!body) return [];

    // One symbol comes back flat; several come back keyed by symbol.
    const rows: QuoteRow[] =
      symbols.length === 1 ? [body as QuoteRow] : Object.values(body).map((row) => row as QuoteRow);

    const byKey = new Map<string, QuoteRow>();
    const bySymbol = new Map<string, QuoteRow>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.status === 'error') continue;
      if (!row.symbol) continue;
      byKey.set(`${row.symbol}@${row.mic_code ?? ''}`, row);
      if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row);
    }

    return keys.flatMap((key): Quote[] => {
      // An empty MIC means "whatever this ticker is primarily" — crypto pairs, which are not
      // listed anywhere, and every position that predates the search box. The vendor answers a
      // bare ticker with its primary listing, and the currency check downstream is what stops
      // that from being applied to a position held on some other exchange.
      const row = byKey.get(`${key.symbol}@${key.micCode}`) ?? bySymbol.get(key.symbol);
      if (!row) return [];

      const price = Number(row.close);
      const currency = row.currency?.trim();
      if (!Number.isFinite(price) || price <= 0 || !currency) return [];

      return [{ symbol: key.symbol, micCode: key.micCode, price, currency, asOf: asOfOf(row) }];
    });
  }

  private async get<T>(url: string, what: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // The refresh decides when to ask; Next's cache must not answer on its behalf.
        cache: 'no-store',
      });
      if (!response.ok) {
        console.warn(`[quotes] ${what} failed: HTTP ${response.status}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      // Never throws at the caller: a feed being down leaves yesterday's price on screen,
      // which is the whole reason the cache exists.
      console.warn(`[quotes] ${what} failed:`, error instanceof Error ? error.message : error);
      return null;
    }
  }
}

/**
 * When the market produced the price.
 *
 * `timestamp` is the bar's own instant and is what we want. `datetime` is the fallback and
 * arrives as a bare date on a daily bar, which parses as midnight UTC — earlier than the
 * close it stands for, so the refresh would immediately think itself owed another fetch.
 * Placing it at 20:00 UTC (16:00 New York, allowing for either offset) is the closer answer.
 */
function asOfOf(row: QuoteRow): Date {
  if (typeof row.timestamp === 'number' && row.timestamp > 0) return new Date(row.timestamp * 1000);
  if (row.datetime) {
    const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(row.datetime);
    const parsed = new Date(isBareDate ? `${row.datetime}T20:00:00Z` : row.datetime);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
