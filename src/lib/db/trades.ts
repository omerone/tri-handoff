import 'server-only';
import { MANUAL_ONLY } from './manual-trades';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import type { AssetClass, DealKind, Direction, TradeStyle } from '@/lib/mt5/types';
import type { RiskResult } from '@/lib/mt5/risk';
import type { TpTiming } from '@/lib/review/types';
import { assertContext } from './context';
import { computeRisk } from '@/lib/mt5/risk';
import { findSymbolSpec } from '@/lib/mt5/symbols';
import { SYNCED_ONLY } from './manual-trades';
import { prisma } from './prisma';

/**
 * Trades.
 *
 * Everything here is scoped by `ctx.userId` *and* joined back to `ctx.tenantId`, so a context
 * that somehow paired one tenant with another's user still selects nothing. The join costs a
 * little; one trader's book being visible on another's domain would cost rather more.
 *
 * Prisma returns `Decimal` for money columns. Conversion to `number` happens here, at the
 * boundary, so the analytics engine is plain arithmetic — see the note in schema.prisma.
 */

export type TradeRecord = {
  id: string;
  ticket: string;
  kind: DealKind;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date | null;
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  /** Net of commission and swap: the money that actually moved. */
  profit: number;
  risk: number | null;
  rr: number | null;
  /** Worst move against the entry while open, in account currency. Null when unknown. */
  mae: number | null;
  /** Best move in favour of the entry while open. Null when unknown. */
  mfe: number | null;
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
  /** How the exit compared to the plan's timing; null while unanswered. */
  tpTiming: TpTiming | null;
  /** Whether the original take-profit was the one that closed it; null while unanswered. */
  tookOriginalTp: boolean | null;
};

/*
 * The sync writes everything a broker knows and nothing a trader wrote, which is why the
 * journal columns and the two review answers are excluded here as well as in `upsertTrades`.
 * A refresh must not be able to erase an answer someone gave.
 */
export type TradeUpsert = Omit<
  TradeRecord,
  'id' | 'note' | 'tags' | 'rating' | 'mood' | 'strategy' | 'tpTiming' | 'tookOriginalTp'
> & {
  /**
   * Why `risk` is null, when it is. Not stored — it decides whether the null is written.
   *
   * A null risk beside a stop loss is two different events wearing the same face: the stop
   * moved past the entry so there is genuinely nothing at risk, or the symbol could not be
   * priced this run. The row cannot tell them apart and the write has to.
   */
  riskReason: RiskResult['reason'];
};

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

type TradeRow = {
  id: string;
  ticket: string;
  kind: DealKind;
  symbol: string;
  assetClass: AssetClass;
  direction: Direction;
  style: TradeStyle;
  openAt: Date;
  closeAt: Date | null;
  volume: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  exitPrice: Prisma.Decimal | null;
  sl: Prisma.Decimal | null;
  tp: Prisma.Decimal | null;
  commission: Prisma.Decimal;
  swap: Prisma.Decimal;
  profit: Prisma.Decimal;
  risk: Prisma.Decimal | null;
  rr: Prisma.Decimal | null;
  mae: Prisma.Decimal | null;
  mfe: Prisma.Decimal | null;
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
  tpTiming: TpTiming | null;
  tookOriginalTp: boolean | null;
};

function toRecord(row: TradeRow): TradeRecord {
  return {
    id: row.id,
    ticket: row.ticket,
    kind: row.kind,
    symbol: row.symbol,
    assetClass: row.assetClass,
    direction: row.direction,
    style: row.style,
    openAt: row.openAt,
    closeAt: row.closeAt,
    volume: Number(row.volume),
    entryPrice: Number(row.entryPrice),
    exitPrice: num(row.exitPrice),
    stopLoss: num(row.sl),
    takeProfit: num(row.tp),
    commission: Number(row.commission),
    swap: Number(row.swap),
    profit: Number(row.profit),
    risk: num(row.risk),
    rr: num(row.rr),
    mae: num(row.mae),
    mfe: num(row.mfe),
    note: row.note,
    tags: row.tags,
    rating: row.rating,
    mood: row.mood,
    strategy: row.strategy,
    tpTiming: row.tpTiming,
    tookOriginalTp: row.tookOriginalTp,
  };
}

/**
 * Idempotent import.
 *
 * Keyed on `(user_id, mt5_account_id, ticket)`, so re-running a sync — which happens on
 * every login, and again whenever the user hits refresh — updates rather than duplicates.
 * That matters beyond tidiness: a duplicated trade would inflate net P&L and drag win rate
 * toward the duplicated outcome, and nothing in the UI would look wrong.
 *
 * **The account is part of the key**, not a passenger. A trader can run two broker accounts —
 * one for day trades, one for swings — and two brokers can issue the same position ticket. On
 * the old key the second account's trade would land on the first's row and overwrite it, and
 * the book would be missing a trade it never reported losing.
 *
 * Returns how many rows were new, which is what the sync log reports back to the user.
 */
export async function upsertTrades(
  ctx: TenantContext,
  mt5AccountId: string,
  trades: TradeUpsert[],
): Promise<{ imported: number; updated: number }> {
  assertContext(ctx);
  if (trades.length === 0) return { imported: 0, updated: 0 };

  const tickets = trades.map((trade) => trade.ticket);
  const existing = await prisma.trade.findMany({
    where: { userId: ctx.userId, mt5AccountId, ticket: { in: tickets } },
    select: { ticket: true },
  });
  const known = new Set(existing.map((row) => row.ticket));

  // Note what is *not* here: note, tags, rating, mood and strategy. The sync owns what the
  // broker reports and rewrites it every run; the journal columns are the user's own words
  // about the trade, and a routine re-sync silently erasing a month of them would be
  // unrecoverable. `TradeUpsert` omits them at the type level so this cannot drift.
  const data = (trade: TradeUpsert) => ({
    kind: trade.kind,
    symbol: trade.symbol,
    assetClass: trade.assetClass,
    direction: trade.direction,
    style: trade.style,
    openAt: trade.openAt,
    closeAt: trade.closeAt,
    volume: trade.volume,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    sl: trade.stopLoss,
    tp: trade.takeProfit,
    commission: trade.commission,
    swap: trade.swap,
    profit: trade.profit,
    /*
     * The same rule as MAE below, and the same reason: do not let a failure erase an answer.
     *
     * Risk needs a symbol specification, and that comes over the network. When the call fails,
     * or the broker names a currency nothing converts from, risk comes back null — and writing
     * it would blank a figure an earlier sync worked out correctly. A re-sync re-reads the last
     * two days every time, so one bad fetch takes the R multiple off every recent trade.
     *
     * **Only those two reasons.** Every other null is the truth about the trade and must be
     * written: a stop removed, a stop trailed past the entry, a stop sitting exactly on it.
     * Those all mean nothing is at risk any more, and keeping the old number leaves an R
     * measured against a stop that no longer exists — a trailed stop is the exact case, because
     * the stop-loss field beside it updates to the new level and nothing on screen contradicts
     * the stale multiple. That is the 213.66R failure `mt5/risk.ts` opens by describing,
     * reached from the write side instead of the arithmetic side.
     */
    ...(trade.risk === null &&
    (trade.riskReason === 'unconvertible' || trade.riskReason === 'unknown-symbol')
      ? {}
      : { risk: trade.risk, rr: trade.rr }),
    /*
     * Only written when a value was computed.
     *
     * The excursion pass is budgeted and every one of its failures is a no-op — a provider
     * with no candle endpoint, a symbol with no history, a request that timed out. Writing
     * `null` on those would erase a figure an earlier sync had successfully worked out, so an
     * older trade that fell outside this run's budget would lose its MAE every time anyone
     * pressed refresh. Absent means "nothing new to say", not "there is nothing".
     */
    ...(trade.mae === null ? {} : { mae: trade.mae }),
    ...(trade.mfe === null ? {} : { mfe: trade.mfe }),
  });

  // Chunked so a full backfill of a long-lived account doesn't build one enormous
  // transaction; the whole point of the ticket key is that a partial run is safe to repeat.
  const CHUNK = 200;
  for (let offset = 0; offset < trades.length; offset += CHUNK) {
    const chunk = trades.slice(offset, offset + CHUNK);
    await prisma.$transaction(
      chunk.map((trade) =>
        prisma.trade.upsert({
          where: {
            userId_mt5AccountId_ticket: {
              userId: ctx.userId,
              mt5AccountId,
              ticket: trade.ticket,
            },
          },
          create: { userId: ctx.userId, mt5AccountId, ticket: trade.ticket, ...data(trade) },
          update: data(trade),
        }),
      ),
    );
  }

  const imported = trades.filter((trade) => !known.has(trade.ticket)).length;
  return { imported, updated: trades.length - imported };
}

/**
 * Prices trades that carry a stop loss but no risk — including the ones no sync can reach.
 *
 * This exists because fixing the code was not enough. A broken symbol-specification fetch left
 * a book where 56 of 74 trades had a stop and 10 had an R multiple, and a re-sync only rewrites
 * what the broker still reports: `upsertTrades` keys on `(userId, mt5AccountId, ticket)`, so a
 * row whose account link was cleared by an old disconnect can never be matched again. In the
 * client's data that was 48 of the 74 trades, 37 of them with a perfectly good stop. Without
 * this pass they stay blank forever and the client's complaint stands after the fix.
 *
 * **Only the unambiguous conversion.** A risk figure is money, and every shortcut here is a
 * chance to write a plausible one that is wrong. So four things are refused rather than
 * guessed:
 *
 *   - **A rate.** A row is priced only when the symbol is quoted in the currency of the
 *     account it belongs to, which needs no conversion at all. That covered all 37 in
 *     practice — dollar pairs on a dollar account — and nothing else is attempted.
 *   - **Which currency an orphan was in.** The row's own account is what decides, and an
 *     orphan has none. Its currency is taken from the trader's accounts only when they all
 *     agree; with a dollar account and a euro account open, an orphan is left alone rather
 *     than priced in whichever one happened to sync first.
 *   - **A hand-entered trade.** Those carry a risk the trader typed, and the entry price is
 *     optional on that form — a blank one is stored as zero, which makes the distance to the
 *     stop the stop's whole price. Left as it is, that produces five thousand dollars of risk
 *     on a trade that never had any, and it looks entirely real.
 *   - **An open trade.** There is no result to divide by the risk yet, and writing a risk with
 *     no R would both break the invariant the schema states and put "re-sync to fill this in"
 *     under a figure no sync will ever fill in, because the row now has a risk.
 *
 * Idempotent, and narrow by construction: it reads only rows that are missing the value, and
 * writes only rows it could compute. Running it twice does nothing the second time.
 */
export async function repairMissingRisk(
  ctx: TenantContext,
  currencyByAccount: ReadonlyMap<string, string>,
): Promise<number> {
  assertContext(ctx);

  // The one currency to price an account-less row in, or nothing when the trader's accounts
  // disagree and there is therefore no answer that is not a guess.
  const currencies = new Set([...currencyByAccount.values()].map((code) => code.toUpperCase()));
  const orphanCurrency = currencies.size === 1 ? [...currencies][0]! : null;

  const rows = await prisma.trade.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      kind: 'trade',
      sl: { not: null },
      // Both directions: rows with no risk that should have one, and rows carrying one the
      // rules now refuse. See the note below on why the second half cannot be left out.
      // Closed only: an open trade has no R to go with the risk.
      exitPrice: { not: null },
      ...SYNCED_ONLY,
    },
    select: {
      id: true,
      symbol: true,
      direction: true,
      volume: true,
      entryPrice: true,
      sl: true,
      profit: true,
      risk: true,
      mt5AccountId: true,
    },
  });

  const repairs: { id: string; risk: number | null; rr: number | null }[] = [];

  /*
   * The reasons that are facts about the trade itself, and so are safe to act on here.
   *
   * Each of these is decided from the entry, the stop, the side and the size — nothing that
   * depends on which symbol specification was in scope when the sync ran. `unconvertible` and
   * `unknown-symbol` are deliberately absent: the sync may have priced a row with a rate or a
   * broker contract size this pass has no access to, and clearing on those would delete a good
   * figure because the pass is less well informed than the run that wrote it.
   */
  const INTRINSIC = new Set(['no-stop-loss', 'no-volume', 'zero-distance', 'stop-beyond-entry']);

  for (const row of rows) {
    const entryPrice = Number(row.entryPrice);
    const stored = row.risk === null ? null : Number(row.risk);

    /*
     * Clearing a stored figure the rules now refuse, which is the half that cannot be left out.
     *
     * A stop trailed to within a basis point of the entry gives a risk of pennies and an R in
     * the thousands. Production carried exactly one — ETHUSD, a stop 0.75 of a basis point out,
     * nine cents of risk, **2,126.67R** — and it was already stored, so the pass that fills in
     * missing values would never look at it. Nothing else would either: it closed in May, and a
     * refresh only re-reads the last two days. One row, sitting in every average the trader
     * reads, permanently.
     *
     * Only the reasons above, and only against the row's own numbers, so this needs no spec.
     */
    if (stored !== null) {
      const { reason } = computeRisk({
        symbol: row.symbol,
        volume: Number(row.volume),
        entryPrice,
        stopLoss: Number(row.sl),
        direction: row.direction,
        // Any code works: none of the intrinsic reasons is reached through a conversion.
        accountCurrency: 'USD',
        spec: findSymbolSpec(row.symbol) ?? undefined,
      });
      if (reason !== null && INTRINSIC.has(reason)) {
        repairs.push({ id: row.id, risk: null, rr: null });
      }
      continue;
    }

    const account =
      row.mt5AccountId === null
        ? orphanCurrency
        : (currencyByAccount.get(row.mt5AccountId)?.toUpperCase() ?? null);
    if (account === null) continue;

    const spec = findSymbolSpec(row.symbol);
    if (!spec || spec.quoteCurrency !== account) continue;
    if (!(entryPrice > 0)) continue;

    const { risk } = computeRisk({
      symbol: row.symbol,
      volume: Number(row.volume),
      entryPrice,
      stopLoss: Number(row.sl),
      direction: row.direction,
      accountCurrency: account,
      spec,
    });
    if (risk === null) continue;

    // `profit` is already net of commission and swap — see the column's own note in
    // schema.prisma, and `upsertTrades` above, which stores it that way. Adding the costs
    // again here subtracted them twice and cost a fifth of an R on a trade with real
    // commission, which is the sort of wrong that reads as right.
    repairs.push({ id: row.id, risk, rr: Number(row.profit) / risk });
  }

  for (const repair of repairs) {
    await prisma.trade.update({
      where: { id: repair.id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
      data: { risk: repair.risk, rr: repair.rr },
    });
  }

  return repairs.length;
}

/**
 * Which of these tickets already have both excursion figures stored.
 *
 * The sync asks before spending anything on price history. A closed trade's high and low are
 * history and history does not move, so re-fetching candles for a trade that already has an
 * answer is the same request billed again for the same number — and the two-day overlap
 * window means every refresh would otherwise do exactly that for everything closed recently.
 *
 * Both columns, not either: they are written together, and a row with one of them is a row
 * whose computation was interrupted and should be tried again rather than trusted.
 *
 * The `in` list is bounded by the sync's own page size, and an empty one short-circuits
 * rather than issuing a query that can only return nothing.
 */
export async function ticketsWithExcursions(
  ctx: TenantContext,
  tickets: readonly string[],
): Promise<Set<string>> {
  assertContext(ctx);
  if (tickets.length === 0) return new Set();

  const rows = await prisma.trade.findMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      ticket: { in: [...tickets] },
      mae: { not: null },
      mfe: { not: null },
    },
    select: { ticket: true },
  });

  return new Set(rows.map((row) => row.ticket));
}

export type TradeFilter = {
  assetClass?: AssetClass;
  direction?: Direction;
  style?: TradeStyle;
  symbol?: string;
  strategy?: string;
  tag?: string;
  from?: Date;
  to?: Date;
  /** Free text, matched across the symbol and everything the trader wrote. See `textSearch`. */
  query?: string;
  /**
   * One broker account, when the trader wants to read one book rather than both.
   *
   * `'manual'` selects the trades they typed — the string rather than `null` because an absent
   * field already means "no filter", and the two must not collide.
   *
   * **"Typed" is the ticket namespace, not a null account.** Disconnecting a broker keeps the
   * trades on purpose and the foreign key is `ON DELETE SET NULL`, so a real broker trade ends
   * up with no account the moment its connection is removed. Reading null as "the trader typed
   * this" would then quietly reclassify a whole imported history as hand-entered — which is
   * exactly what happened here: one press of disconnect left forty-nine synced trades with a
   * null account. The prefix survives that, because it is on the row itself.
   */
  mt5AccountId?: string | 'manual';
};

/**
 * What a free-text search looks in.
 *
 * The dropdowns beside the box answer "which trades are of this kind"; this answers "where did
 * I write that", which is the question a journal exists for and the one the table could not
 * answer at all — four thousand characters of note were reachable only by opening the trade
 * they were written on.
 *
 * `symbol` is in the list because it is what a trader types first and the dropdowns have no
 * entry for it: asset class narrows to "forex", not to EURUSD.
 *
 * Tags match exactly while the text fields match loosely. Postgres array containment has no
 * case-insensitive form in Prisma's query API, and the alternative — dropping to raw SQL for
 * one predicate — would take this function out of the type checker's reach for the sake of a
 * value the trader picks from a dropdown two inches to the left. It is a real difference, so
 * it is written down rather than smoothed over.
 *
 * No index answers `contains`; every one of these is a scan. Both list queries cap at 5000
 * rows per trader, which is the ceiling this stays fast under — a book that outgrows it wants
 * `pg_trgm` and a GIN index, not a bigger `take`.
 */
function textSearch(query: string): Prisma.TradeWhereInput[] {
  const contains = { contains: query, mode: 'insensitive' } as const;
  return [
    { symbol: contains },
    { strategy: contains },
    { note: contains },
    { mood: contains },
    { tags: { has: query } },
  ];
}

function whereClause(
  ctx: TenantContext,
  filter: TradeFilter = {},
  options: { closedOnly?: boolean } = {},
): Prisma.TradeWhereInput {
  const closeAt: Prisma.DateTimeNullableFilter = {};
  if (filter.from) closeAt.gte = filter.from;
  if (filter.to) closeAt.lte = filter.to;
  if (options.closedOnly) closeAt.not = null;

  return {
    userId: ctx.userId,
    // Belt and braces: a context is only ever minted from a verified tenant/user pair, but
    // the join means even a forged one selects nothing.
    user: { tenantId: ctx.tenantId },
    // Analytics is about trading performance; deposits and withdrawals are not trades.
    kind: 'trade',
    ...(filter.assetClass ? { assetClass: filter.assetClass } : {}),
    ...(filter.direction ? { direction: filter.direction } : {}),
    ...(filter.style ? { style: filter.style } : {}),
    ...(filter.symbol ? { symbol: filter.symbol } : {}),
    ...(filter.strategy ? { strategy: filter.strategy } : {}),
    ...(filter.tag ? { tags: { has: filter.tag } } : {}),
    ...(filter.mt5AccountId === undefined
      ? {}
      : filter.mt5AccountId === 'manual'
        ? MANUAL_ONLY
        : { mt5AccountId: filter.mt5AccountId }),
    ...(filter.query ? { OR: textSearch(filter.query) } : {}),
    ...(Object.keys(closeAt).length > 0 ? { closeAt } : {}),
  };
}

/** Every closed trade, oldest first — what the analytics engine runs over. */
export async function listClosedTrades(
  ctx: TenantContext,
  filter: TradeFilter = {},
): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: whereClause(ctx, filter, { closedOnly: true }),
    orderBy: [{ closeAt: 'asc' }, { ticket: 'asc' }],
    take: 5000,
  });
  return rows.map(toRecord);
}

/**
 * Realised P&L on everything closed before an instant.
 *
 * What the equity curve of a *window* has to start from. Without it, "this month" drew a curve
 * beginning at the account's deposit total — as though the previous two years of trading had
 * not happened — and the drawdown percentage underneath it was measured against that same
 * fiction.
 *
 * Deliberately not filtered by anything but the date: this is the account's balance, not the
 * selected subset's. Narrowing to short crypto does not mean the account started the month
 * with only the short crypto.
 */
export async function realisedProfitBefore(ctx: TenantContext, instant: Date): Promise<number> {
  assertContext(ctx);
  const result = await prisma.trade.aggregate({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      kind: 'trade',
      closeAt: { not: null, lt: instant },
    },
    _sum: { profit: true },
  });
  return Number(result._sum.profit ?? 0);
}

export async function countTrades(ctx: TenantContext, filter: TradeFilter = {}): Promise<number> {
  assertContext(ctx);
  return prisma.trade.count({ where: whereClause(ctx, filter, { closedOnly: true }) });
}

/** Paginated table view of closed trades, newest first. */
export async function pageTrades(
  ctx: TenantContext,
  filter: TradeFilter,
  page: { offset: number; limit: number },
): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: whereClause(ctx, filter, { closedOnly: true }),
    orderBy: [{ closeAt: 'desc' }, { ticket: 'desc' }],
    skip: page.offset,
    take: page.limit,
  });
  return rows.map(toRecord);
}

/** Deposits, withdrawals and corrections — excluded from performance, shown in the balance. */
export async function listCashFlow(ctx: TenantContext): Promise<TradeRecord[]> {
  assertContext(ctx);
  const rows = await prisma.trade.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, kind: { not: 'trade' } },
    orderBy: { openAt: 'asc' },
    take: 1000,
  });
  return rows.map(toRecord);
}

/** Wipes the book — used when the user connects a different MT5 account. */
/**
 * Wipes the *synced* book. Called when a different broker account is connected, because the
 * stored history belongs to the account being replaced.
 *
 * Manual trades survive, and that is the whole point of the exclusion. They are not the old
 * account's history — they are what the trader typed themselves, often before any broker was
 * connected at all, and the reasoning that makes deleting the synced rows correct ("this
 * history is another book's") says the opposite about these. Deleting them here would mean
 * connecting a broker silently destroyed the journal someone kept by hand while waiting to.
 */
export async function deleteAllTrades(ctx: TenantContext): Promise<number> {
  assertContext(ctx);
  const { count } = await prisma.trade.deleteMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, ...SYNCED_ONLY },
  });
  return count;
}

/**
 * One broker account's synced history, and nothing else.
 *
 * `deleteAllTrades` takes every synced row the trader has, which was the whole book while a
 * trader could only connect one account. With two, replacing the account in one slot must
 * leave the other slot's history alone — and the manual rows, which belong to neither.
 */
export async function deleteTradesForAccount(
  ctx: TenantContext,
  mt5AccountId: string,
): Promise<number> {
  assertContext(ctx);
  const { count } = await prisma.trade.deleteMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      mt5AccountId,
      ...SYNCED_ONLY,
    },
  });
  return count;
}

/**
 * The rows a trader picked out of the table, whatever they came from.
 *
 * Unlike the two above, this one deletes synced trades as readily as hand-typed ones. That is
 * the point of it — the trader is looking at a row and saying "not this one" — and it is also
 * the reason the caller has to be honest about what it buys: while the account that produced a
 * row is still connected, the next refresh reads a two-day overlap from the newest close and
 * writes it straight back. Deleting an old trade sticks; deleting last night's does not. The
 * confirmation says so, because a delete that silently undoes itself is worse than no delete.
 *
 * Disconnecting is the durable answer, and it clears the credentials, so nothing can put the
 * rows back — see `deleteTradesForAccount`.
 *
 * Ids are filtered by owner in the same statement rather than checked first: a borrowed id
 * from another tenant matches nothing and deletes nothing, with no round trip that could
 * report on somebody else's book by its absence.
 */
export async function deleteTradesByIds(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<number> {
  assertContext(ctx);
  if (ids.length === 0) return 0;
  const { count } = await prisma.trade.deleteMany({
    where: { id: { in: [...ids] }, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return count;
}

export async function getTrade(ctx: TenantContext, id: string): Promise<TradeRecord | null> {
  assertContext(ctx);
  const row = await prisma.trade.findFirst({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
  return row ? toRecord(row) : null;
}

/**
 * The journal fields a trader writes themselves (SPEC §1.1, adopted from tradeReport).
 *
 * Deliberately a separate write path from the sync. The sync owns everything the broker
 * reports and overwrites it on every run; these columns are the only ones it must never
 * touch, because they are the one part of a trade the broker does not know about — and
 * losing a month of trade notes to a routine re-sync would be unrecoverable.
 */
export type TradeJournal = {
  note: string | null;
  tags: string[];
  rating: number | null;
  mood: string | null;
  strategy: string | null;
};

/**
 * The two review answers, written one trade at a time from the row they belong to.
 *
 * Separate from `updateTradeJournal` because they are set from a different place and at a
 * different moment: the journal form saves every field it holds at once, so routing a single
 * dropdown through it would blank whatever the trader had not retyped.
 */
export type TradeReview = {
  tpTiming?: TpTiming | null;
  tookOriginalTp?: boolean | null;
};

export async function updateTradeReview(
  ctx: TenantContext,
  id: string,
  review: TradeReview,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.trade.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: review,
  });
  return count > 0;
}

export async function updateTradeJournal(
  ctx: TenantContext,
  id: string,
  journal: TradeJournal,
): Promise<boolean> {
  assertContext(ctx);
  const { count } = await prisma.trade.updateMany({
    where: { id, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: journal,
  });
  return count > 0;
}

/**
 * Strategies and tags the user has already used, for autocomplete.
 *
 * Without suggestions "Breakout", "breakout" and "break-out" become three strategies by the
 * third week, and the by-strategy breakdown stops meaning anything — the same reasoning as
 * the finance categories.
 */
export async function listJournalVocabulary(
  ctx: TenantContext,
): Promise<{ strategies: string[]; tags: string[]; moods: string[] }> {
  assertContext(ctx);
  /*
   * Both books, one vocabulary.
   *
   * A long-term holding now carries the same five journal columns a synced trade does, and
   * the reason for taking a position is the reason for taking it whether the broker reported
   * the fill or the trader typed it. Suggesting from only one of the two would quietly split
   * "Breakout" into a day-trade Breakout and a long-trade breakout — which is the exact
   * outcome this function exists to prevent, arrived at from the other direction.
   */
  const [tradeRows, positionRows] = await Promise.all([
    prisma.trade.findMany({
      where: { userId: ctx.userId, user: { tenantId: ctx.tenantId }, kind: 'trade' },
      select: { strategy: true, tags: true, mood: true },
      orderBy: { closeAt: 'desc' },
      take: 1000,
    }),
    prisma.longPosition.findMany({
      where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
      select: { strategy: true, tags: true, mood: true },
      orderBy: { buyDate: 'desc' },
      take: 1000,
    }),
  ]);

  const strategies = new Set<string>();
  const tags = new Set<string>();
  const moods = new Set<string>();

  for (const row of [...tradeRows, ...positionRows]) {
    if (row.strategy) strategies.add(row.strategy);
    if (row.mood) moods.add(row.mood);
    for (const tag of row.tags) tags.add(tag);
  }

  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
  return { strategies: sorted(strategies), tags: sorted(tags), moods: sorted(moods) };
}

export async function newestCloseAt(
  ctx: TenantContext,
  /** Scopes the cursor to one broker account; omitted, it answers for the whole journal. */
  mt5AccountId?: string,
): Promise<Date | null> {
  assertContext(ctx);
  const row = await prisma.trade.findFirst({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      closeAt: { not: null },
      ...(mt5AccountId === undefined ? {} : { mt5AccountId }),
    },
    orderBy: { closeAt: 'desc' },
    select: { closeAt: true },
  });
  return row?.closeAt ?? null;
}
