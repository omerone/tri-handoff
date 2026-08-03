import 'server-only';
import { env } from '@/lib/env';
import { MockQuoteProvider } from './mock/provider';
import { TwelveDataProvider } from './twelvedata/provider';
import type { QuoteProvider } from './types';

export * from './types';
export {
  assetKind,
  CRYPTO_MAX_AGE_MS,
  isMarketOpen,
  isQuoteStale,
  lastMarketClose,
  MARKET_TIME_ZONE,
  MIN_REFETCH_MS,
  needsRefresh,
  type AssetKind,
  type CachedQuote,
} from './market';

let cached: QuoteProvider | null = null;

/**
 * The market-data provider, chosen by `QUOTES_PROVIDER`.
 *
 * Defaults to the mock, so a fresh checkout, the test suite and a demo all work with no
 * vendor account anywhere — turning the real feed on is one environment variable.
 */
export function quotesProvider(): QuoteProvider {
  if (cached) return cached;

  const config = env();
  cached =
    config.QUOTES_PROVIDER === 'twelvedata'
      ? new TwelveDataProvider(config.TWELVEDATA_API_KEY)
      : new MockQuoteProvider();

  return cached;
}

/** Test seam: forces the next `quotesProvider()` call to rebuild from the environment. */
export function resetQuotesProvider(): void {
  cached = null;
}
