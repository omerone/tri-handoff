import 'server-only';
import { cache } from 'react';
import { getMt5Account, listCashFlow, listClosedTrades, type TradeFilter } from '@/lib/db';
import type { TenantContext } from '@/lib/tenant/context';
import { toAnalyticsTrades } from './index';
import type { AnalyticsTrade } from './types';

/**
 * Loads the book for a request.
 *
 * Request-cached, so the dashboard's six KPI tiles, R-strip and equity curve cost one query
 * between them rather than one each.
 *
 * The whole book is loaded into memory rather than aggregated in SQL. That is a deliberate
 * trade: a retail trading account is thousands of rows at most, the analytics engine stays
 * pure and exhaustively testable, and every dimension is computed from the same in-memory
 * list — which is what makes "the buckets always sum to the total" true by construction
 * rather than by six matching GROUP BY clauses. If a client ever turns up with a
 * six-figure trade count, this is the function to change, and only this one.
 */
export type Book = {
  trades: AnalyticsTrade[];
  /** Deposits and withdrawals: where the account balance came from. */
  startBalance: number;
  accountCurrency: string;
  connected: boolean;
};

export const loadBook = cache(async (ctx: TenantContext, filter?: TradeFilter): Promise<Book> => {
  const [records, cashFlow, account] = await Promise.all([
    listClosedTrades(ctx, filter),
    listCashFlow(ctx),
    getMt5Account(ctx),
  ]);

  // The equity curve starts where the money came in, not at an invented round number.
  const startBalance = cashFlow.reduce((sum, entry) => sum + entry.profit, 0);

  return {
    trades: toAnalyticsTrades(records),
    startBalance,
    accountCurrency: account?.accountCurrency ?? 'USD',
    connected: account !== null,
  };
});
