import { describe, expect, it } from 'vitest';
import { aggregateDeals } from './provider';

/**
 * MT5 does not hand over positions, it hands over deals: an entry and one or more exits
 * sharing a `positionId`. Folding them is the piece of the MetaApi provider most likely to
 * need adjustment against a live broker, so it is separated from the HTTP client and tested
 * against fixtures shaped like MetaApi's documented history format.
 *
 * These fixtures are hand-built from that documentation, not captured from a live account —
 * which is exactly why the aggregation is exported and tested rather than buried in a method
 * nobody can exercise without a subscription.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  positionId: 'p1',
  type: 'DEAL_TYPE_BUY',
  entryType: 'DEAL_ENTRY_IN',
  symbol: 'EURUSD',
  volume: 1,
  price: 1.1,
  time: '2026-07-01T10:00:00.000Z',
  stopLoss: 1.09,
  takeProfit: 1.13,
  commission: -7,
  swap: 0,
  profit: 0,
  ...over,
});

const exit = (over: Record<string, unknown> = {}) => ({
  id: 'd2',
  positionId: 'p1',
  type: 'DEAL_TYPE_SELL',
  entryType: 'DEAL_ENTRY_OUT',
  symbol: 'EURUSD',
  volume: 1,
  price: 1.12,
  time: '2026-07-01T14:00:00.000Z',
  commission: -7,
  swap: -2,
  profit: 200,
  ...over,
});

describe('aggregateDeals', () => {
  it('folds an entry and an exit into one closed position', () => {
    const [deal] = aggregateDeals([entry(), exit()]);

    expect(deal).toMatchObject({
      ticket: 'p1',
      kind: 'trade',
      symbol: 'EURUSD',
      direction: 'long',
      volume: 1,
      entryPrice: 1.1,
      exitPrice: 1.12,
      stopLoss: 1.09,
      takeProfit: 1.13,
      profit: 200,
    });
    // Charges from both deals, not just the exit.
    expect(deal!.commission).toBe(-14);
    expect(deal!.swap).toBe(-2);
    expect(deal!.openAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    expect(deal!.closeAt!.toISOString()).toBe('2026-07-01T14:00:00.000Z');
  });

  it('reads direction from the entry deal, not the exit', () => {
    // The exit of a long is a SELL; taking direction from it would invert every trade.
    const [long] = aggregateDeals([entry(), exit()]);
    expect(long!.direction).toBe('long');

    const [short] = aggregateDeals([
      entry({ type: 'DEAL_TYPE_SELL' }),
      exit({ type: 'DEAL_TYPE_BUY' }),
    ]);
    expect(short!.direction).toBe('short');
  });

  it('sums a position that was scaled out over several exits', () => {
    const [deal] = aggregateDeals([
      entry({ volume: 2 }),
      exit({ id: 'd2', volume: 1, profit: 100, commission: -3, time: '2026-07-01T12:00:00.000Z' }),
      exit({ id: 'd3', volume: 1, profit: 150, commission: -3, time: '2026-07-01T15:00:00.000Z' }),
    ]);

    expect(deal!.profit).toBe(250);
    expect(deal!.commission).toBe(-13);
    // Closed when the last piece was closed.
    expect(deal!.closeAt!.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });

  it('skips a position that is still open', () => {
    // No exit deal yet — reporting it as closed would invent an exit price of zero.
    expect(aggregateDeals([entry()])).toEqual([]);
  });

  it('keeps deposits and withdrawals as balance deals, out of the trade stream', () => {
    const deals = aggregateDeals([
      {
        id: 'b1',
        type: 'DEAL_TYPE_BALANCE',
        time: '2026-05-01T09:00:00.000Z',
        profit: 10_000,
      },
      entry(),
      exit(),
    ]);

    const balance = deals.find((deal) => deal.kind === 'balance')!;
    expect(balance.profit).toBe(10_000);
    expect(balance.symbol).toBe('');
    expect(balance.volume).toBe(0);
    // And it is not confused for a trade.
    expect(deals.filter((deal) => deal.kind === 'trade')).toHaveLength(1);
  });

  it('leaves the stop loss null when the position carried none', () => {
    const [deal] = aggregateDeals([entry({ stopLoss: undefined }), exit()]);
    expect(deal!.stopLoss).toBeNull();
  });

  it('falls back to the stop loss recorded on the exit', () => {
    // Some brokers only stamp SL/TP on the closing deal.
    const [deal] = aggregateDeals([entry({ stopLoss: undefined }), exit({ stopLoss: 1.08 })]);
    expect(deal!.stopLoss).toBe(1.08);
  });

  it('normalises the broker suffix off the symbol', () => {
    const [deal] = aggregateDeals([entry({ symbol: 'EURUSD.raw' }), exit()]);
    expect(deal!.symbol).toBe('EURUSD');
  });

  it('handles several positions and returns them oldest close first', () => {
    const deals = aggregateDeals([
      entry({ positionId: 'p2', id: 'e2', time: '2026-07-02T10:00:00.000Z' }),
      exit({ positionId: 'p2', id: 'x2', time: '2026-07-02T11:00:00.000Z' }),
      entry(),
      exit(),
    ]);

    expect(deals.map((deal) => deal.ticket)).toEqual(['p1', 'p2']);
  });

  describe('a position built in instalments', () => {
    /**
     * Scaling in was the half of this that was never folded.
     *
     * Exits were summed from the start; entries took the first fill's volume and price and
     * discarded the rest. It is not a rounding error: `computeRisk` multiplies volume by the
     * entry-to-stop distance, so a position built in three parts reported a third of the risk
     * it actually carried and three times the R multiple it actually earned — and those feed
     * the RR aggregates, the coverage figure and the risk-dispersion metric.
     */
    const scaledIn = () => [
      entry({ id: 'e1', volume: 1, price: 1.1, time: '2026-07-01T10:00:00.000Z' }),
      entry({ id: 'e2', volume: 1, price: 1.2, time: '2026-07-01T11:00:00.000Z' }),
      entry({ id: 'e3', volume: 2, price: 1.3, time: '2026-07-01T12:00:00.000Z' }),
      exit({ id: 'x1', volume: 4, price: 1.4, time: '2026-07-01T15:00:00.000Z', profit: 400 }),
    ];

    it('reports the whole size, not the first fill', () => {
      const [deal] = aggregateDeals(scaledIn());
      expect(deal!.volume).toBe(4);
    });

    it('averages the entry price by volume, as the terminal does', () => {
      // (1×1.1 + 1×1.2 + 2×1.3) / 4 = 4.9 / 4 = 1.225. Weighting is the whole point: an
      // unweighted mean of the three fills would say 1.2, and the last fill was the big one.
      const [deal] = aggregateDeals(scaledIn());
      expect(deal!.entryPrice).toBeCloseTo(1.225, 10);
      expect(deal!.entryPrice).not.toBeCloseTo(1.2, 3);
    });

    it('opens at the first fill and closes at the last exit', () => {
      const [deal] = aggregateDeals(scaledIn());
      expect(deal!.openAt.toISOString()).toBe('2026-07-01T10:00:00.000Z');
      expect(deal!.closeAt!.toISOString()).toBe('2026-07-01T15:00:00.000Z');
    });

    it('still charges commission on every fill', () => {
      const [deal] = aggregateDeals(scaledIn());
      // Four deals at -7 apiece.
      expect(deal!.commission).toBe(-28);
    });

    it('is unchanged for the ordinary single-entry position', () => {
      const [deal] = aggregateDeals([entry({ volume: 2, price: 1.15 }), exit()]);
      expect(deal!.volume).toBe(2);
      expect(deal!.entryPrice).toBe(1.15);
    });

    it('scales in and out at once', () => {
      const deals = aggregateDeals([
        entry({ id: 'e1', volume: 2, price: 1.0, time: '2026-07-01T10:00:00.000Z' }),
        entry({ id: 'e2', volume: 2, price: 1.1, time: '2026-07-01T10:30:00.000Z' }),
        exit({ id: 'x1', volume: 2, price: 1.2, time: '2026-07-01T14:00:00.000Z', profit: 300 }),
        exit({ id: 'x2', volume: 2, price: 1.3, time: '2026-07-01T16:00:00.000Z', profit: 500 }),
      ]);

      expect(deals[0]!.volume).toBe(4);
      expect(deals[0]!.entryPrice).toBeCloseTo(1.05, 10);
      // The exit price is the last one out, and the money is the sum of both.
      expect(deals[0]!.exitPrice).toBe(1.3);
      expect(deals[0]!.profit).toBe(800);
    });
  });

  it('ignores a deal with no position and no balance type', () => {
    expect(aggregateDeals([{ id: 'x', type: 'DEAL_TYPE_UNKNOWN', time: '2026-07-01T10:00:00Z' }])).toEqual(
      [],
    );
  });
});
