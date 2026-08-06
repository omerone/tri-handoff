import 'server-only';
import { env } from '@/lib/env';
import { MockMt5Provider } from './mock/provider';
import { MetaApiProvider } from './metaapi/provider';
import type { Mt5Provider } from './types';

export * from './types';
export { computeRisk, computeRr, netProfit } from './risk';
export { classifySymbol, findSymbolSpec, normalizeSymbol } from './symbols';

let cached: Mt5Provider | null = null;

/**
 * The provider the app runs on, chosen by `MT5_PROVIDER`.
 *
 * Everything above this call works against the `Mt5Provider` interface, so switching a
 * deployment from demo data to a live broker is an environment variable — no code path in the
 * sync, the analytics or the UI knows the difference.
 */
export function mt5Provider(): Mt5Provider {
  if (cached) return cached;

  const config = env();
  cached =
    config.MT5_PROVIDER === 'metaapi'
      ? new MetaApiProvider(config.METAAPI_TOKEN, config.METAAPI_REGION, {
          keepDeployed: config.METAAPI_KEEP_DEPLOYED,
        })
      : new MockMt5Provider();

  return cached;
}

/** Test seam: forces the next `mt5Provider()` call to rebuild from the environment. */
export function resetMt5Provider(): void {
  cached = null;
}
