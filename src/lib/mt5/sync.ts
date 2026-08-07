import 'server-only';
import { decryptSecret } from '@/lib/crypto/secretbox';
import {
  failStaleSyncLogs,
  finishSyncLog,
  newestCloseAt,
  readCredentialCiphertexts,
  recordSnapshot,
  repairMissingRisk,
  ticketsWithExcursions,
  recordSyncFailure,
  recordSyncSuccess,
  startSyncLog,
  upsertTrades,
  type SyncTrigger,
  type TradeUpsert,
} from '@/lib/db';
import { sameZonedDay } from '@/lib/time/zone';
import type { TenantContext } from '@/lib/tenant/context';
import { computeExcursion, NO_EXCURSION, type Excursion } from './excursion';
import { mt5Provider } from './index';
import { baseImpliesRate, computeRr } from './risk';
import { classifySymbol, findSymbolSpec, type SymbolSpec } from './symbols';
import type {
  Mt5AccountState,
  Mt5Credentials,
  Mt5Deal,
  SymbolSpecOverride,
  TradeStyle,
} from './types';

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

/**
 * Syncs every account the trader has connected, and reports the run as a whole.
 *
 * One log line and one outcome for what may be two broker round trips, because that is what
 * the person who pressed refresh is waiting for. **One account failing does not fail the
 * run**: a swing account whose broker is briefly unreachable must not stop the day account's
 * trades arriving, and the alternative — abandoning the loop on the first error — would make
 * the whole journal hostage to the least reliable connection. Failures are collected, recorded
 * against the account they belong to, and reported once everything that could be read has been.
 */
export async function syncMt5(ctx: TenantContext, trigger: SyncTrigger): Promise<SyncOutcome> {
  const accounts = await readCredentialCiphertexts(ctx);
  if (accounts.length === 0) return { status: 'skipped', reason: 'not-connected' };

  await failStaleSyncLogs(ctx);
  const logId = await startSyncLog(ctx, trigger);

  let imported = 0;
  let updated = 0;
  let accountCurrency: string | null = null;
  const failures: string[] = [];
  // Per account, not one for the run: a trader can hold a dollar account and a euro one, and
  // pricing either one's trades in the other's currency is a wrong number that looks fine.
  const currencyByAccount = new Map<string, string>();

  for (const stored of accounts) {
    try {
      const result = await syncOneAccount(ctx, trigger, stored);
      imported += result.imported;
      updated += result.updated;
      accountCurrency ??= result.currency;
      currencyByAccount.set(stored.id, result.currency);
    } catch (error) {
      // Deliberately not rethrown. The credentials are in scope in the frame below, and an
      // unhandled error would put a stack trace containing them in front of a user.
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${stored.login}: ${message}`);
      await recordSyncFailure(ctx, stored.id);
      console.error('[mt5] sync failed for', stored.login, '—', message);
    }
  }

  if (failures.length === accounts.length) {
    const message = failures.join('; ');
    await finishSyncLog(ctx, logId, { status: 'error', error: message });
    return { status: 'error', message };
  }

  /*
   * Trades the loop above could not have touched.
   *
   * `upsertTrades` matches on `(userId, mt5AccountId, ticket)`, so a row whose account link was
   * cleared by an old disconnect is invisible to every sync that will ever run — and the client
   * whose report started this had 48 of those, 37 with a valid stop and no risk. Repairing them
   * is not part of importing from a broker, but this is the only moment the app knows both that
   * a user is looking and what their account is denominated in.
   *
   * Each account's own currency goes with it, and an account that failed this run contributes
   * none — so its trades are left rather than priced against a neighbour's denomination.
   */
  if (currencyByAccount.size > 0) {
    const repaired = await repairMissingRisk(ctx, currencyByAccount);
    if (repaired > 0)
      console.warn('[mt5] priced', repaired, 'trade(s) that had a stop but no risk');
  }

  await finishSyncLog(ctx, logId, {
    status: 'success',
    tradesImported: imported,
    tradesUpdated: updated,
    // A partially successful run is a successful run with something worth saying about it.
    error: failures.length > 0 ? failures.join('; ') : undefined,
  });

  return { status: 'success', imported, updated, accountCurrency: accountCurrency ?? 'USD' };
}

/** One broker account, start to finish. Throws; the caller decides what a failure means. */
async function syncOneAccount(
  ctx: TenantContext,
  trigger: SyncTrigger,
  stored: {
    id: string;
    login: string;
    server: string;
    investorPwEncrypted: string;
    providerAccountId: string | null;
    /** What the account is for; null keeps the calendar rule. See `styleOf`. */
    purpose: TradeStyle | null;
  },
): Promise<{ imported: number; updated: number; currency: string }> {
  try {
    const credentials: Mt5Credentials = {
      login: stored.login,
      server: stored.server,
      investorPassword: decryptSecret(stored.investorPwEncrypted),
      // The tenant boundary, carried down to the broker: the provider registers and finds the
      // account under this, so one client's book cannot be reached from another's session.
      // The tenant boundary, carried down to the broker, and now the account boundary with
      // it: two accounts belonging to one trader must register separately with the provider.
      accountKey: ctx.userId,
    };

    const provider = mt5Provider();
    // A backfill means what it says: read the account from the beginning. Everything else
    // resumes from where the journal ends.
    const since = trigger === 'backfill' ? null : await incrementalCursor(ctx, stored.id);

    const [account, deals] = await Promise.all([
      provider.fetchAccountState(credentials),
      provider.fetchDeals(credentials, since ? { since } : {}),
    ]);

    // A backfill recomputes the excursions it already has; every other trigger trusts them.
    const trades = await toTradeRecords(
      ctx,
      stored.purpose,
      deals,
      account,
      credentials,
      trigger === 'backfill',
    );
    const { imported, updated } = await upsertTrades(ctx, stored.id, trades);

    await recordSyncSuccess(ctx, stored.id, {
      currency: account.currency,
      balance: account.balance,
      equity: account.equity,
    });
    /*
     * The same two figures again, this time kept rather than overwritten.
     *
     * `recordSyncSuccess` writes them onto `mt5_accounts`, where the next sync replaces them
     * — so the product knew what the account is worth now and could never say what it was
     * worth in March. One row per day; see db/snapshots.ts for why this is not the same thing
     * as the equity curve, which is built from trades and ignores deposits on purpose.
     *
     * After the trades are stored and after the sync is marked successful, because it is
     * bookkeeping: it swallows its own failures and must not be able to turn a good sync bad.
     */
    await recordSnapshot(ctx, {
      balance: account.balance,
      equity: account.equity,
      currency: account.currency,
    });
    return { imported, updated, currency: account.currency };
  } finally {
    /*
     * Hand the terminal back, whether the sync worked or not.
     *
     * A metered provider charges for the hours the account is *running*, and TRi reads a
     * broker on a button press and then does nothing for days — so a terminal left up is rent
     * on a machine nobody is reading. In `finally` rather than after the return, because the
     * expensive thing to leak is the one a *failed* sync leaves behind: an account that threw
     * on its first read is exactly the account nobody will think to stop.
     *
     * `release` swallows its own failures; this awaits it only so the request is actually
     * issued before the process moves on.
     */
    const provider = mt5Provider();
    if (provider.release) {
      await provider.release({
        login: stored.login,
        server: stored.server,
        investorPassword: decryptSecret(stored.investorPwEncrypted),
        accountKey: ctx.userId,
        ...(stored.providerAccountId ? { providerAccountId: stored.providerAccountId } : {}),
      });
    }
  }
}

/**
 * Null on the first connect — the full historical backfill SPEC §3.6 depends on. MT5 keeps
 * the whole account history, so everything the trader had in their previous journal comes
 * back from the broker without needing to export anything from it.
 *
 * Only ever consulted for an incremental trigger. This used to run unconditionally, which
 * quietly disarmed the one path that exists to repair a journal: connecting an account with
 * any trades already stored asked the broker for "everything since the newest close", got
 * nothing, and reported success. A wall of green syncs that imported zero rows is what that
 * looks like from the outside, and it is indistinguishable from a broker with no new deals.
 */
async function incrementalCursor(ctx: TenantContext, mt5AccountId: string): Promise<Date | null> {
  // Per account, not per trader: a swing account connected today would otherwise inherit the
  // day account's cursor and be told there is nothing older than this week to fetch.
  const newest = await newestCloseAt(ctx, mt5AccountId);
  return newest ? new Date(newest.getTime() - OVERLAP_MS) : null;
}

async function toTradeRecords(
  ctx: TenantContext,
  purpose: TradeStyle | null,
  deals: Mt5Deal[],
  account: Mt5AccountState,
  credentials: Mt5Credentials,
  recomputeAll: boolean,
): Promise<TradeUpsert[]> {
  const provider = mt5Provider();

  const symbols = [...new Set(deals.filter((d) => d.symbol).map((d) => d.symbol))];
  const overrides = await fetchSpecOverrides(provider, credentials, symbols);
  const quoteRates = await fetchQuoteRates(
    provider,
    credentials,
    symbols,
    account.currency,
    overrides,
  );
  const excursions = await fetchExcursions(ctx, provider, credentials, deals, {
    accountCurrency: account.currency,
    quoteRates,
    overrides,
    recomputeAll,
  });

  return deals.map((deal) => {
    const spec = specFor(deal.symbol, overrides);
    const { risk, rr, reason } = computeRr(deal, {
      accountCurrency: account.currency,
      quoteRates,
      spec,
    });
    const { mae, mfe } = excursions.get(deal.ticket) ?? NO_EXCURSION;

    return {
      ticket: deal.ticket,
      kind: deal.kind,
      symbol: deal.symbol,
      assetClass: classifySymbol(deal.symbol),
      direction: deal.direction,
      style: styleOf(deal, purpose),
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
      // Carried through so the write can tell "nothing was at risk" from "we could not work
      // out what was". See the note on the guard in db/trades.ts; the two look identical here
      // and mean opposite things to a row that already has a figure.
      riskReason: reason,
      mae,
      mfe,
    } satisfies TradeUpsert;
  });
}

/**
 * How many trades one sync will fetch price history for.
 *
 * A backfill can be thousands of deals and each one is a separate request for candles, which
 * on a metered provider is thousands of calls for a screen nobody is waiting on. The newest
 * trades are the ones a trader is looking at, so the budget goes to those and the rest keep
 * their existing values — an incremental sync only ever sees a handful anyway, so in normal
 * use nothing is skipped at all.
 */
const EXCURSION_BUDGET = 200;

/**
 * MAE and MFE for as many of these deals as the budget allows.
 *
 * Every failure here is a no-op. A provider with no `fetchBars`, a symbol the broker has no
 * history for, a request that times out — all of them leave the two columns null, which the
 * UI renders as "unknown" and the aggregates exclude. The trades themselves do not depend on
 * any of it, and a sync that failed because a candle endpoint was slow would be a sync that
 * lost a day of trading over a statistic.
 *
 * The upsert only writes these columns when a value was computed (see `upsertTrades`), so a
 * trade whose history was unavailable this time keeps whatever it had from last time rather
 * than having it wiped.
 */
async function fetchExcursions(
  ctx: TenantContext,
  provider: ReturnType<typeof mt5Provider>,
  credentials: Mt5Credentials,
  deals: Mt5Deal[],
  context: {
    accountCurrency: string;
    quoteRates: Record<string, number>;
    overrides: Map<string, SymbolSpec>;
    /** A backfill recomputes everything; see below. */
    recomputeAll: boolean;
  },
): Promise<Map<string, Excursion>> {
  const result = new Map<string, Excursion>();
  if (!provider.fetchBars) return result;

  const closed = deals.filter(
    (deal) => deal.kind === 'trade' && deal.closeAt !== null && deal.symbol,
  );

  /*
   * Trades that already have an answer are not asked about again.
   *
   * This is the whole cost of the feature in normal use. Every incremental sync re-reads a
   * two-day overlap window — deliberately, because brokers settle commission and swap late —
   * so without this, pressing refresh three times in an afternoon fetched candles three times
   * for every trade closed in the last two days. On a metered provider that is the same
   * request billed over and over for an answer that cannot have changed: a closed trade's
   * high and low are history, and history does not move.
   *
   * A backfill is the exception and the escape hatch. It means "read this account from the
   * beginning", so it recomputes rather than trusting what is stored — which is also the way
   * back if the excursion arithmetic is ever corrected and the old figures need replacing.
   */
  const known = context.recomputeAll
    ? new Set<string>()
    : await ticketsWithExcursions(
        ctx,
        closed.map((deal) => deal.ticket),
      );

  const pending = closed.filter((deal) => !known.has(deal.ticket));

  const candidates = pending
    .sort((a, b) => (b.closeAt?.getTime() ?? 0) - (a.closeAt?.getTime() ?? 0))
    .slice(0, EXCURSION_BUDGET);

  if (candidates.length < pending.length) {
    console.warn(
      `[mt5] excursions computed for the newest ${candidates.length} of ${pending.length} ` +
        'trades that still need them; the rest keep whatever they already had',
    );
  }
  if (known.size > 0) {
    console.warn(`[mt5] skipped ${known.size} trades that already have an excursion`);
  }

  for (const deal of candidates) {
    try {
      const bars = await provider.fetchBars(credentials, {
        symbol: deal.symbol,
        from: deal.openAt,
        to: deal.closeAt!,
      });
      result.set(
        deal.ticket,
        computeExcursion(deal, bars, {
          accountCurrency: context.accountCurrency,
          quoteRates: context.quoteRates,
          spec: specFor(deal.symbol, context.overrides),
        }),
      );
    } catch (error) {
      // One symbol's history being unavailable says nothing about the next one's.
      console.warn(
        `[mt5] no price history for ${deal.symbol}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return result;
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
function styleOf(deal: Mt5Deal, purpose: TradeStyle | null): 'day' | 'swing' {
  // What the account is for beats what the clock says. A trader who keeps one account for
  // swings and another for day trades has already answered this question, and answering it
  // again from the timestamps contradicts them: a swing closed inside one session is still a
  // swing, and filing it under `day` splits one strategy across both breakdowns — which is
  // exactly what having two accounts was meant to stop.
  if (purpose !== null) return purpose;

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
    for (const override of specs) {
      // A spec with no honest contract size is dropped rather than stored: `specFor` then
      // falls through to the static table, which is where it would have looked anyway.
      const spec = merge(override);
      if (spec) map.set(override.symbol.toUpperCase(), spec);
    }
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

/**
 * The broker's numbers on top of what we already know — never instead of it.
 *
 * An override used to replace the static spec wholesale, which meant a field the broker did
 * not send arrived as `undefined` and took a good value with it. That is not hypothetical: the
 * provider read `quoteCurrency` from a MetaApi response that calls it `profitCurrency`, so
 * every override carried no currency, `quoteToAccountRate` could match nothing, and the whole
 * account's risk came out `unconvertible` — but *only* when the spec call succeeded. When it
 * 404'd, the static table was used and risk worked. Better data made the answer worse.
 *
 * So each field falls back rather than the object replacing: the broker is authoritative on
 * contract size and digits, which vary per broker and are exactly why this call exists, and
 * the static table stands in for anything the broker left blank. `??` is wrong here for the
 * currency — an empty string is what a missing field becomes — hence the explicit checks.
 *
 * Returns null when neither side can say what a lot of this instrument is worth. Defaulting to
 * 1 was the tempting alternative and it is the worse failure by far: `computeRisk` refuses on a
 * spec it does not have, but a spec claiming a contract size of one produces a real number,
 * with no reason attached, off by whatever the true size is — a hundred thousand for an FX
 * pair. No spec means no R multiple, which is the documented and visible outcome.
 */
export function merge(override: SymbolSpecOverride): SymbolSpec | null {
  const base = findSymbolSpec(override.symbol);

  // Brokers vary the case and pad the field; `usd` is not a different currency from `USD`, and
  // treating it as one is how the original bug becomes reachable a second way.
  const currency = (value: string | undefined) => value?.trim().toUpperCase() || undefined;

  const contractSize = override.contractSize > 0 ? override.contractSize : base?.contractSize;
  if (!contractSize || !(contractSize > 0)) return null;

  return {
    symbol: override.symbol,
    assetClass: base?.assetClass ?? classifySymbol(override.symbol),
    contractSize,
    quoteCurrency: currency(override.quoteCurrency) ?? base?.quoteCurrency ?? '',
    baseCurrency: currency(override.baseCurrency) ?? base?.baseCurrency,
    digits: override.digits >= 0 ? override.digits : (base?.digits ?? 2),
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
    // The one shared predicate, not a second copy of the condition. When this said only
    // `spec.baseCurrency === accountCurrency` while `computeRisk` also demanded forex, every
    // symbol between the two got neither a fetched rate nor the shortcut — and came out
    // `unconvertible`, which is the exact symptom this whole change set is about.
    if (baseImpliesRate(spec, accountCurrency)) continue;
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
