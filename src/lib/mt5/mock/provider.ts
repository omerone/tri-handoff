import type {
  FetchDealsOptions,
  Mt5AccountState,
  Mt5Credentials,
  Mt5Deal,
  Mt5Provider,
  Mt5VerifyResult,
  PriceBar,
} from '../types';
import { generateMockDeals, MOCK_ACCOUNT_CURRENCY, MOCK_QUOTE_RATES } from './generator';

/**
 * The mock provider: the prototype's book, served through the real port.
 *
 * Used for development, for demos, and — importantly — for the automated tests, which need a
 * broker that answers the same way every time. `MT5_PROVIDER=mock` selects it.
 *
 * It accepts any credentials except an obviously empty one. There is nothing to authenticate
 * against, and pretending otherwise would only mean a demo that can be locked out of itself.
 */
export class MockMt5Provider implements Mt5Provider {
  readonly name = 'mock' as const;

  private cache: Mt5Deal[] | null = null;

  private deals(): Mt5Deal[] {
    this.cache ??= generateMockDeals().deals;
    return this.cache;
  }

  private accountState(credentials: Mt5Credentials): Mt5AccountState {
    // Closed trades only; the deposit is a `balance` deal and counts toward the balance too.
    const balance = this.deals().reduce(
      (sum, deal) => sum + deal.profit + deal.commission + deal.swap,
      0,
    );
    return {
      login: credentials.login,
      server: credentials.server,
      currency: MOCK_ACCOUNT_CURRENCY,
      balance: Math.round(balance * 100) / 100,
      // No open positions in the demo book, so equity equals balance.
      equity: Math.round(balance * 100) / 100,
      name: 'TRi demo account',
    };
  }

  async verify(credentials: Mt5Credentials): Promise<Mt5VerifyResult> {
    if (!credentials.login.trim() || !credentials.investorPassword) {
      return { ok: false, reason: 'invalid-credentials' };
    }
    return { ok: true, account: this.accountState(credentials) };
  }

  async fetchAccountState(credentials: Mt5Credentials): Promise<Mt5AccountState> {
    return this.accountState(credentials);
  }

  async fetchDeals(_credentials: Mt5Credentials, options: FetchDealsOptions = {}): Promise<Mt5Deal[]> {
    const since = options.since;
    if (!since) return this.deals();
    // Incremental sync asks for everything closed at or after the last sync. Inclusive on
    // purpose: a deal closing in the same millisecond as the previous run's cutoff must not
    // fall down the gap between two syncs. Re-importing one is free — the upsert is keyed on
    // the ticket.
    return this.deals().filter((deal) => (deal.closeAt?.getTime() ?? 0) >= since.getTime());
  }

  async fetchQuoteRates(): Promise<Record<string, number>> {
    return MOCK_QUOTE_RATES;
  }

  /**
   * Bars covering a window, synthesised from the deal they belong to.
   *
   * The mock book has no price history — it is a list of results, not a tape — so this builds
   * the smallest thing that produces a *plausible* MAE and MFE: one bar spanning the request,
   * whose high and low straddle the trade's own entry and exit by a fraction of the distance
   * between them.
   *
   * Deterministic, from the same seeded generator as everything else here, so the demo book
   * shows the same numbers on every machine and the golden tests keep working. It is invented
   * data and says so — the point is that the excursion pipeline, the columns, the aggregates
   * and the screen can all be exercised end to end without a broker subscription, which is
   * the same reason the rest of this class exists.
   */
  async fetchBars(
    _credentials: Mt5Credentials,
    request: { symbol: string; from: Date; to: Date },
  ): Promise<PriceBar[]> {
    const deal = this.deals().find(
      (candidate) =>
        candidate.symbol === request.symbol &&
        candidate.openAt.getTime() === request.from.getTime() &&
        candidate.closeAt?.getTime() === request.to.getTime(),
    );
    if (!deal || deal.exitPrice === null) return [];

    const move = Math.abs(deal.exitPrice - deal.entryPrice);
    // A trade that closed exactly at its entry still moved while it was open; a hundredth of
    // the entry price is a small, sane stand-in for "some, but not much".
    const wiggle = (move || deal.entryPrice * 0.01) * this.excursionFactor(deal.ticket);

    const high = Math.max(deal.entryPrice, deal.exitPrice) + wiggle;
    const low = Math.min(deal.entryPrice, deal.exitPrice) - wiggle;

    return [{ at: deal.openAt, open: deal.entryPrice, high, low, close: deal.exitPrice }];
  }

  /**
   * How far past the realised move the invented bar reaches, as a fraction of it.
   *
   * Derived from the ticket rather than drawn from a stream, so it does not depend on the
   * order fetches happen in — two runs that ask about the same trades in different orders get
   * the same answer. Between roughly 0.1 and 0.6: enough spread that the MAE-against-risk
   * chart has a shape, never so much that a trade looks like it was underwater by five times
   * its stop.
   */
  private excursionFactor(ticket: string): number {
    let hash = 0;
    for (const char of ticket) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return 0.1 + (Math.abs(hash) % 500) / 1000;
  }
}
