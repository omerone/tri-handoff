import type { AssetClass } from './types';

/**
 * Symbol specifications — what a price movement is worth.
 *
 * The RR rule in the brief is `risk = |entry − sl| × contract value × volume`, and "contract
 * value" is not a number you can guess from the symbol name: one lot of EURUSD is 100,000
 * euros, one lot of XAUUSD is 100 ounces, one CFD of US500 is a single index point. Getting
 * it wrong does not produce an obviously wrong number, it produces a plausible one that is
 * off by three orders of magnitude — which is exactly the kind of error a trader would act on
 * before noticing.
 *
 * So: a symbol whose spec we do not know gets `risk = null` and is excluded from RR
 * aggregates, rather than being given a made-up contract size. The real MetaApi provider
 * fetches the broker's own specification and overrides this table; these entries are the
 * fallback and what the mock provider runs on.
 */

export type SymbolSpec = {
  symbol: string;
  assetClass: AssetClass;
  /** Units of the base instrument in one lot. */
  contractSize: number;
  /** Currency a price is quoted in — what `|entry − sl| × contractSize × volume` comes out as. */
  quoteCurrency: string;
  /** Currency being bought or sold; only meaningful for FX pairs. */
  baseCurrency?: string;
  /** Decimal places, used to round generated prices to something a broker would print. */
  digits: number;
};

const SPECS: readonly SymbolSpec[] = [
  // --- FX majors: one lot = 100,000 units of the base currency ---
  { symbol: 'EURUSD', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'EUR', quoteCurrency: 'USD', digits: 5 },
  { symbol: 'GBPUSD', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'GBP', quoteCurrency: 'USD', digits: 5 },
  { symbol: 'USDJPY', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'USD', quoteCurrency: 'JPY', digits: 3 },
  { symbol: 'USDCHF', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'USD', quoteCurrency: 'CHF', digits: 5 },
  { symbol: 'AUDUSD', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'AUD', quoteCurrency: 'USD', digits: 5 },
  // A major that was simply missing. On a USD account it is priced through `baseCurrency`,
  // which is why the entry carries one: the pair is quoted in CAD and no rate is needed.
  { symbol: 'USDCAD', assetClass: 'forex', contractSize: 100_000, baseCurrency: 'USD', quoteCurrency: 'CAD', digits: 5 },

  // --- Metals: one lot of gold is 100 troy ounces, silver 5,000 ---
  { symbol: 'XAUUSD', assetClass: 'commodities', contractSize: 100, baseCurrency: 'XAU', quoteCurrency: 'USD', digits: 2 },
  { symbol: 'XAGUSD', assetClass: 'commodities', contractSize: 5_000, baseCurrency: 'XAG', quoteCurrency: 'USD', digits: 3 },
  { symbol: 'USOIL', assetClass: 'commodities', contractSize: 1_000, quoteCurrency: 'USD', digits: 2 },

  // --- Crypto CFDs: one lot = one coin ---
  { symbol: 'BTCUSD', assetClass: 'crypto', contractSize: 1, baseCurrency: 'BTC', quoteCurrency: 'USD', digits: 2 },
  { symbol: 'ETHUSD', assetClass: 'crypto', contractSize: 1, baseCurrency: 'ETH', quoteCurrency: 'USD', digits: 2 },
  { symbol: 'SOLUSD', assetClass: 'crypto', contractSize: 1, baseCurrency: 'SOL', quoteCurrency: 'USD', digits: 2 },

  // --- Index CFDs: one contract = one index point ---
  { symbol: 'US500', assetClass: 'indices', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'NAS100', assetClass: 'indices', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  /*
   * The same index as NAS100, under the names other brokers print.
   *
   * There is no canonical spelling for a CFD: one house's NAS100 is another's US100, USTEC
   * or NDX. A table keyed to one house's vocabulary silently drops every trade on the others
   * — four live trades with perfectly good stops came out with no risk for exactly this, and
   * the screen blamed a missing stop loss. Duplicated rather than aliased because a spec is
   * cheap and an alias table is a second thing to keep in step.
   */
  { symbol: 'US100', assetClass: 'indices', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'USTEC', assetClass: 'indices', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'US30', assetClass: 'indices', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  // Quoted in euros by most brokers — the case that proves the risk calculation has to
  // convert to the account currency rather than assume it already is.
  { symbol: 'GER40', assetClass: 'indices', contractSize: 1, quoteCurrency: 'EUR', digits: 2 },

  // --- Share CFDs: one contract = one share ---
  { symbol: 'AAPL', assetClass: 'stocks', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'NVDA', assetClass: 'stocks', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'TSLA', assetClass: 'stocks', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
  { symbol: 'MSFT', assetClass: 'stocks', contractSize: 1, quoteCurrency: 'USD', digits: 2 },
];

const BY_SYMBOL = new Map(SPECS.map((spec) => [spec.symbol, spec]));

/**
 * Brokers suffix symbols to mark the account type — `EURUSD.raw`, `XAUUSD-ECN`, `US500m`.
 * Stripping those is the difference between classifying a book correctly and filing all of
 * it under "other".
 */
export function normalizeSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/[._-][A-Z0-9]{1,6}$/, '')
    .replace(/[._-]/g, '');
}

export function findSymbolSpec(symbol: string): SymbolSpec | null {
  const direct = BY_SYMBOL.get(symbol.trim().toUpperCase());
  if (direct) return direct;
  return BY_SYMBOL.get(normalizeSymbol(symbol)) ?? null;
}

const CRYPTO_HINTS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'LTC', 'BNB'];
const METAL_HINTS = ['XAU', 'XAG', 'XPT', 'XPD', 'OIL', 'GAS', 'WTI', 'BRENT'];
// `NAS` already catches every suffixed spelling of the Nasdaq that uses that name; the
// other three are the names it goes by elsewhere, and without them `US100m` from the house
// that prints it that way classified as 'other'.
// prettier-ignore
const INDEX_HINTS = ['US500', 'US30', 'NAS', 'GER', 'UK100', 'JP225', 'FRA40', 'AUS200', 'SPX', 'DAX', 'US100', 'USTEC', 'NDX'];
const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD'];

/**
 * Best-effort classification for a symbol with no spec entry.
 *
 * Only ever used for the asset-class *dimension*, never for the risk calculation — guessing
 * that something is crypto is harmless, guessing its contract size is not.
 */
export function classifySymbol(symbol: string): AssetClass {
  const spec = findSymbolSpec(symbol);
  if (spec) return spec.assetClass;

  const name = normalizeSymbol(symbol);
  if (METAL_HINTS.some((hint) => name.startsWith(hint))) return 'commodities';
  if (CRYPTO_HINTS.some((hint) => name.startsWith(hint))) return 'crypto';
  if (INDEX_HINTS.some((hint) => name.includes(hint))) return 'indices';

  const isSixLetterPair =
    name.length === 6 &&
    FX_CURRENCIES.includes(name.slice(0, 3)) &&
    FX_CURRENCIES.includes(name.slice(3));
  if (isSixLetterPair) return 'forex';

  // Plain alphabetic tickers of 1–5 characters are share CFDs far more often than anything
  // else; everything left is honestly "other".
  if (/^[A-Z]{1,5}$/.test(name)) return 'stocks';
  return 'other';
}

export const KNOWN_SYMBOLS = SPECS.map((spec) => spec.symbol);
