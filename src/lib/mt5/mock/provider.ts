import type {
  FetchDealsOptions,
  Mt5AccountState,
  Mt5Credentials,
  Mt5Deal,
  Mt5Provider,
  Mt5VerifyResult,
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
}
