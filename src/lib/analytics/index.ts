export * from './types';
export * from './metrics';
export * from './dimensions';

import type { TradeRecord } from '@/lib/db/trades';
import type { AnalyticsTrade } from './types';

/**
 * Database record → analytics trade.
 *
 * The only adapter between the two layers, and the only place that decides what "a trade the
 * engine should count" means: closed, and an actual market position rather than a deposit.
 */
export function toAnalyticsTrades(records: readonly TradeRecord[]): AnalyticsTrade[] {
  const result: AnalyticsTrade[] = [];

  for (const record of records) {
    if (record.kind !== 'trade' || record.closeAt === null) continue;
    result.push({
      id: record.id,
      symbol: record.symbol,
      assetClass: record.assetClass,
      direction: record.direction,
      style: record.style,
      openAt: record.openAt,
      closeAt: record.closeAt,
      profit: record.profit,
      risk: record.risk,
      rr: record.rr,
      strategy: record.strategy,
    });
  }

  // Close order: the equity curve and drawdown both depend on it, and the database ordering
  // is a query detail rather than a guarantee.
  result.sort((a, b) => a.closeAt.getTime() - b.closeAt.getTime());
  return result;
}
