import 'server-only';
import { cache } from 'react';
import {
  getMt5Account,
  listCashFlow,
  listClosedTrades,
  realisedProfitBefore,
  type TradeFilter,
} from '@/lib/db';
import type { TenantContext } from '@/lib/tenant/context';
import { toAnalyticsTrades } from './index';
import type { AnalyticsTrade } from './types';

/**
 * Loads the book for a request.
 *
 * Request-cached, so the dashboard's six KPI tiles, R-strip and equity curve cost one query
 * between them rather than one each. The cache is keyed on the arguments, so two different
 * windows in one request are two loads — which is what a caller asking for both would mean.
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
  /**
   * What the account was worth when the window opened, and therefore where the equity curve
   * starts and what the drawdown percentage is measured against.
   */
  openingBalance: number;
  accountCurrency: string;
  connected: boolean;
};

export const loadBook = cache(async (ctx: TenantContext, filter?: TradeFilter): Promise<Book> => {
  const from = filter?.from ?? null;

  const [records, cashFlow, account, realisedBefore] = await Promise.all([
    listClosedTrades(ctx, filter),
    listCashFlow(ctx),
    getMt5Account(ctx),
    // One aggregate, and only when there is a window to open. All-time needs no "before".
    from ? realisedProfitBefore(ctx, from) : Promise.resolve(0),
  ]);

  /*
   * Where the curve starts.
   *
   * Unbounded, that is the money that came in — the equity curve begins where the account did
   * rather than at an invented round number, and deposits are not performance so they are not
   * points on it.
   *
   * Bounded, it is the same idea moved forward: the deposits that had arrived by then, plus
   * everything already realised. The two agree at the boundary in the normal case, where the
   * deposits precede the first trade.
   *
   * Deposits made *inside* the window are deliberately left out of the curve. A deposit is not
   * a trading result, and a curve that steps up on the day money was wired would report the
   * wire as a good day and inflate every drawdown measured after it.
   */
  const deposits = cashFlow
    .filter((entry) => (from === null ? true : entry.openAt < from))
    .reduce((sum, entry) => sum + entry.profit, 0);

  return {
    trades: toAnalyticsTrades(records),
    openingBalance: deposits + realisedBefore,
    accountCurrency: account?.accountCurrency ?? 'USD',
    connected: account !== null,
  };
});
