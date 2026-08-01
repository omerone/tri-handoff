import 'server-only';
import { decryptSecret } from '@/lib/crypto/secretbox';
import {
  failStaleSyncLogs,
  finishSyncLog,
  newestCloseAt,
  readCredentialCiphertext,
  recordSyncFailure,
  recordSyncSuccess,
  startSyncLog,
  upsertTrades,
  type SyncTrigger,
  type TradeUpsert,
} from '@/lib/db';
import { sameZonedDay } from '@/lib/time/zone';
import type { TenantContext } from '@/lib/tenant/context';
import { mt5Provider } from './index';
import { computeRr } from './risk';
import { classifySymbol, findSymbolSpec, type SymbolSpec } from './symbols';
import type { Mt5AccountState, Mt5Credentials, Mt5Deal, SymbolSpecOverride } from './types';

/**
 * The sync.
 *
 * Runs on every login (SPEC §3.3) and again whenever the user asks. Two things make that
 * safe to do as often as it happens: every import is keyed on `(user_id, ticket)` so
 * repeating one changes nothing, and a failure is recorded rather than thrown at the user —
 * a broker being briefly unreachable must not stop someone reading last month's numbers.
 */

export type SyncOutcome =
  | { status: 'success'; imported: number; updated: number; accountCurrency: string }
  | { status: 'skipped'; reason: 'not-connected' }
  | { status: 'error'; message: string };

/**
 * How far back an incremental sync re-reads.
 *
 * Not "since the last sync": a broker can settle a deal minutes after it closed, and swap is
 * sometimes booked later still, so the newest close time we have is a floor, not a
 * watermark. Re-reading a couple of days costs one request and a few upserts that change
 * nothing, and it is the difference between a complete journal and one with occasional
 * holes that nobody would ever notice.
 */
const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000;

export async function syncMt5(ctx: TenantContext, trigger: SyncTrigger): Promise<SyncOutcome> {
  const stored = await readCredentialCiphertext(ctx);
  if (!stored) return { status: 'skipped', reason: 'not-connected' };

  await failStaleSyncLogs(ctx);
  const logId = await startSyncLog(ctx, trigger);

  try {
    const credentials: Mt5Credentials = {
      login: stored.login,
      server: stored.server,
      investorPassword: decryptSecret(stored.investorPwEncrypted),
    };

    const provider = mt5Provider();
    const since = await incrementalCursor(ctx);

    const [account, deals] = await Promise.all([
      provider.fetchAccountState(credentials),
      provider.fetchDeals(credentials, since ? { since } : {}),
    ]);

    const trades = await toTradeRecords(deals, account, credentials);
    const { imported, updated } = await upsertTrades(ctx, trades);

    await recordSyncSuccess(ctx, {
      currency: account.currency,
      balance: account.balance,
      equity: account.equity,
    });
    await finishSyncLog(ctx, logId, { status: 'success', tradesImported: imported, tradesUpdated: updated });

    return { status: 'success', imported, updated, accountCurrency: account.currency };
  } catch (error) {
    // Deliberately not rethrown. The credentials are in scope here, and an unhandled error
    // would put a stack trace containing this frame in front of a user.
    const message = error instanceof Error ? error.message : String(error);
    await recordSyncFailure(ctx);
    await finishSyncLog(ctx, logId, { status: 'error', error: message });
    console.error('[mt5] sync failed:', message);
    return { status: 'error', message };
  }
}

/**
 * Null on the first connect — the full historical backfill SPEC §3.6 depends on. MT5 keeps
 * the whole account history, so everything the trader had in their previous journal comes
 * back from the broker without needing to export anything from it.
 */
async function incrementalCursor(ctx: TenantContext): Promise<Date | null> {
  const newest = await newestCloseAt(ctx);
  return newest ? new Date(newest.getTime() - OVERLAP_MS) : null;
}

async function toTradeRecords(
  deals: Mt5Deal[],
  account: Mt5AccountState,
  credentials: Mt5Credentials,
): Promise<TradeUpsert[]> {
  const provider = mt5Provider();

  const symbols = [...new Set(deals.filter((d) => d.symbol).map((d) => d.symbol))];
  const overrides = await fetchSpecOverrides(provider, credentials, symbols);
  const quoteRates = await fetchQuoteRates(provider, credentials, symbols, account.currency, overrides);

  return deals.map((deal) => {
    const spec = specFor(deal.symbol, overrides);
    const { risk, rr } = computeRr(deal, {
      accountCurrency: account.currency,
      quoteRates,
      spec,
    });

    return {
      ticket: deal.ticket,
      kind: deal.kind,
      symbol: deal.symbol,
      assetClass: classifySymbol(deal.symbol),
      direction: deal.direction,
      style: styleOf(deal),
      openAt: deal.openAt,
      closeAt: deal.closeAt,
      volume: deal.volume,
      entryPrice: deal.entryPrice,
      exitPrice: deal.exitPrice,
      stopLoss: deal.stopLoss,
      takeProfit: deal.takeProfit,
      commission: deal.commission,
      swap: deal.swap,
      // Stored net, so every downstream sum is the money that actually moved.
      profit: deal.profit + deal.commission + deal.swap,
      risk,
      rr,
    } satisfies TradeUpsert;
  });
}

/**
 * Day or swing.
 *
 * Decided by the calendar, in the analytics timezone, not by elapsed hours: a position
 * opened at 09:00 and closed at 23:00 is a day trade, and one opened at 23:00 and closed at
 * 01:00 is not — even though the second was held for less time. That is how a trader
 * describes their own book, and it is what keeps a day trade on a single square of the
 * calendar.
 */
function styleOf(deal: Mt5Deal): 'day' | 'swing' {
  if (!deal.closeAt) return 'day';
  return sameZonedDay(deal.openAt, deal.closeAt) ? 'day' : 'swing';
}

async function fetchSpecOverrides(
  provider: ReturnType<typeof mt5Provider>,
  credentials: Mt5Credentials,
  symbols: string[],
): Promise<Map<string, SymbolSpec>> {
  const map = new Map<string, SymbolSpec>();
  if (!provider.fetchSymbolSpecs || symbols.length === 0) return map;

  try {
    const specs = await provider.fetchSymbolSpecs(credentials, symbols);
    for (const override of specs) map.set(override.symbol.toUpperCase(), merge(override));
  } catch (error) {
    // The broker's own numbers are better than the built-in table, but not so much better
    // that failing to fetch them should fail the sync — the fallback is a documented table,
    // and anything missing from it yields no RR rather than a wrong one.
    console.warn(
      '[mt5] symbol specifications unavailable, using the built-in table:',
      error instanceof Error ? error.message : error,
    );
  }
  return map;
}

function merge(override: SymbolSpecOverride): SymbolSpec {
  const base = findSymbolSpec(override.symbol);
  return {
    symbol: override.symbol,
    assetClass: base?.assetClass ?? classifySymbol(override.symbol),
    contractSize: override.contractSize,
    quoteCurrency: override.quoteCurrency,
    baseCurrency: base?.baseCurrency,
    digits: override.digits,
  };
}

function specFor(symbol: string, overrides: Map<string, SymbolSpec>): SymbolSpec | null {
  return overrides.get(symbol.toUpperCase()) ?? findSymbolSpec(symbol);
}

/**
 * Rates for symbols quoted in a currency that is neither the account currency nor implied by
 * the pair itself — GER40 in euros on a dollar account.
 */
async function fetchQuoteRates(
  provider: ReturnType<typeof mt5Provider>,
  credentials: Mt5Credentials,
  symbols: string[],
  accountCurrency: string,
  overrides: Map<string, SymbolSpec>,
): Promise<Record<string, number>> {
  const needed = new Set<string>();

  for (const symbol of symbols) {
    const spec = specFor(symbol, overrides);
    if (!spec) continue;
    if (spec.quoteCurrency === accountCurrency) continue;
    if (spec.baseCurrency === accountCurrency) continue; // Derived from the price itself.
    needed.add(`${spec.quoteCurrency}${accountCurrency}`);
  }

  if (needed.size === 0 || !provider.fetchQuoteRates) return {};

  try {
    return await provider.fetchQuoteRates(credentials, [...needed]);
  } catch (error) {
    // Without a rate those symbols get no RR and are reported in the coverage figure, which
    // is the honest outcome — better than converting at a made-up rate.
    console.warn(
      '[mt5] quote rates unavailable; affected trades will have no RR:',
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}
