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

  it('ignores a deal with no position and no balance type', () => {
    expect(aggregateDeals([{ id: 'x', type: 'DEAL_TYPE_UNKNOWN', time: '2026-07-01T10:00:00Z' }])).toEqual(
      [],
    );
  });
});
