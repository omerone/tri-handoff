/**
 * Long-term positions — the third trading style in SPEC §1, the one that lives outside MT5
 * and is entered by hand.
 *
 * Prices are updated manually (SPEC §3.4 settles this: no market-data feed), which makes the
 * age of a price part of the number. A position last valued in March is not wrong, but a net
 * worth built from it is only as current as that. Everything here therefore carries
 * `valueUpdatedAt` alongside the value, and the UI shows it.
 *
 * Pure: no I/O, no clock beyond what is passed in.
 */

export type LongPosition = {
  id: string;
  symbol: string;
  qty: number;
  buyPrice: number;
  buyDate: Date;
  /** Latest price **per unit**, entered by hand. */
  currentPrice: number;
  valueUpdatedAt: Date;
  fees: number;
  currency: string;
  /** Set when the position was closed; null while it is open. */
  realizedPnl: number | null;
  closedAt: Date | null;
  note: string | null;
};

export type PositionValuation = {
  /** What it cost, including fees. */
  cost: number;
  /** What it is worth at the last entered price. */
  value: number;
  /** value − cost. */
  unrealized: number;
  unrealizedPercent: number;
  /** Whole days since the price was last touched. */
  priceAgeDays: number;
};

export function valuePosition(position: LongPosition, asOf: Date): PositionValuation {
  // Fees are part of what the position cost: a holding that is level on price but paid
  // commission is down, and a P&L that says otherwise is flattering.
  const cost = position.buyPrice * position.qty + position.fees;
  const value = position.currentPrice * position.qty;
  const unrealized = value - cost;

  return {
    cost,
    value,
    unrealized,
    unrealizedPercent: cost > 0 ? (unrealized / cost) * 100 : 0,
    priceAgeDays: Math.max(
      0,
      Math.floor((asOf.getTime() - position.valueUpdatedAt.getTime()) / 86_400_000),
    ),
  };
}

export type PortfolioTotals = {
  cost: number;
  value: number;
  unrealized: number;
  unrealizedPercent: number;
  realized: number;
  openCount: number;
  closedCount: number;
  /** Age of the *stalest* open price — the honest headline for "how current is this". */
  stalestPriceDays: number;
};

/**
 * Portfolio roll-up.
 *
 * Open and closed positions are summed separately and deliberately: unrealized P&L is a
 * position that still exists and can still move, realized P&L is money that has landed.
 * Adding them would produce a single number that means neither.
 *
 * All positions are assumed to share one currency — the caller converts before totalling.
 */
export function portfolioTotals(positions: readonly LongPosition[], asOf: Date): PortfolioTotals {
  let cost = 0;
  let value = 0;
  let realized = 0;
  let openCount = 0;
  let closedCount = 0;
  let stalest = 0;

  for (const position of positions) {
    if (position.closedAt !== null) {
      closedCount += 1;
      realized += position.realizedPnl ?? 0;
      continue;
    }

    const valuation = valuePosition(position, asOf);
    cost += valuation.cost;
    value += valuation.value;
    openCount += 1;
    stalest = Math.max(stalest, valuation.priceAgeDays);
  }

  const unrealized = value - cost;
  return {
    cost,
    value,
    unrealized,
    unrealizedPercent: cost > 0 ? (unrealized / cost) * 100 : 0,
    realized,
    openCount,
    closedCount,
    stalestPriceDays: stalest,
  };
}

/**
 * Realized P&L for a position being closed at `sellPrice`.
 *
 * Fees are already in the cost basis, so they are not subtracted twice here — the sale's own
 * fee is added by the caller if there is one.
 */
export function realizedPnlOnClose(position: LongPosition, sellPrice: number): number {
  const cost = position.buyPrice * position.qty + position.fees;
  return sellPrice * position.qty - cost;
}

/** A price older than this is called out in the UI. */
export const STALE_PRICE_DAYS = 14;

export function isStale(valuation: PositionValuation): boolean {
  return valuation.priceAgeDays >= STALE_PRICE_DAYS;
}
