import type { TradeUpsert } from '@/lib/db/trades';
import { computeRr } from '@/lib/mt5/risk';
import { classifySymbol, findSymbolSpec, normalizeSymbol } from '@/lib/mt5/symbols';
import type { DealKind, Direction, Mt5Deal } from '@/lib/mt5/types';
import { ANALYTICS_TIME_ZONE, fromWallClock, sameZonedDay } from '@/lib/time/zone';
import {
  detectDecimalSeparator,
  detectDelimiter,
  isBlankRow,
  parseNumber,
  splitDelimited,
  stableHash,
  type DecimalSeparator,
} from './delimited';

/**
 * FTMO MetriX "Trading Journal" CSV import.
 *
 * The point of this file is that a trader can have real numbers in TRi in thirty seconds,
 * with no broker password, no MetaApi account and no waiting for a provisioning queue:
 * Client Area → Accounts Overview → MetriX → Trading Journal → Export → CSV, then upload.
 *
 * ## What the export actually looks like
 *
 * Semicolon-separated, one header row, no metadata rows, newest trade first:
 *
 *     Ticket;Open;Type;Volume;Symbol;Price;SL;TP;Close;Price;Swap;Commissions;Profit;Pips;"Trade duration in seconds"
 *     114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28
 *     113667493;"2022-02-24 15:52:26";sell;10.00;ETHUSD;2401.44;2395;2383;"2022-02-24 16:05:52";2394.24;0;-0.96;72;7.2;806
 *
 * Note `Price` twice: the first is the entry, the second is the exit. That is the single
 * most important thing to know about this file and the one thing a naive header-keyed
 * reader gets wrong, because most CSV libraries silently keep only the last of a duplicated
 * column name and would hand back the exit price for both.
 *
 * ## How confident we are, and what that buys the reader
 *
 * The column *order* above is corroborated by three independent sources and is the thing
 * this parser leans on hardest. The column *names* are corroborated for English exports
 * only — FTMO's Client Area is localised, and at least one importer in the wild reads this
 * file purely positionally because it has seen French headers (`Ouvrir`, `Fermeture`,
 * `Durée du trade en secondes`).
 *
 * So: names first, position as a guarded fallback, and a loud failure when neither fits.
 * `readFtmoCsv` never guesses at a header it does not recognise — it throws an
 * `FtmoParseError` that prints the header it was given, the fields it could not find and
 * the layout it expected. A wrong import here is not a visible error, it is a plausible
 * equity curve, so refusing to parse is always the better answer.
 *
 * ## What is *not* corroborated
 *
 * No sample we have contains a deposit, withdrawal or balance correction — the MetriX
 * journal appears to list closed positions only. Those rows are handled anyway, using the
 * MT4/MT5 statement convention (`Type` of `balance` / `deposit` / `withdrawal` / `credit` /
 * `correction`, empty symbol, amount in `Profit`), because getting them wrong is
 * catastrophic and silent: a deposit filed as a trade is excluded from nothing, and it
 * would add the whole account size to net P&L and count as a winning trade. If FTMO never
 * emits such a row the branch is dead code, which costs nothing.
 */

/** Exactly the layout every sample and every third-party importer agrees on. */
const FTMO_COLUMN_ORDER = [
  'ticket',
  'openAt',
  'type',
  'volume',
  'symbol',
  'entryPrice',
  'stopLoss',
  'takeProfit',
  'closeAt',
  'exitPrice',
  'swap',
  'commission',
  'profit',
  'pips',
  'duration',
] as const;

type Field = (typeof FTMO_COLUMN_ORDER)[number];

/** Fields without which a row cannot become a trade. `stopLoss`/`takeProfit` are not among
 * them: an export stripped of them yields trades with no RR, which is honest, whereas an
 * export missing its prices yields nonsense. */
const REQUIRED_FIELDS: readonly Field[] = [
  'ticket',
  'openAt',
  'type',
  'volume',
  'symbol',
  'entryPrice',
  'closeAt',
  'exitPrice',
  'swap',
  'commission',
  'profit',
];

const NUMERIC_FIELDS: readonly Field[] = [
  'volume',
  'entryPrice',
  'stopLoss',
  'takeProfit',
  'exitPrice',
  'swap',
  'commission',
  'profit',
];

/**
 * Header aliases, normalised (lower-cased, de-accented, punctuation collapsed to spaces).
 *
 * English is what FTMO's own export writes. The French entries are attested from another
 * importer's notes on real user files. Nothing else is guessed at — an unrecognised
 * localisation falls through to the positional reader below, which is safer than an
 * invented translation that happens to collide with a different column.
 */
const HEADER_ALIASES: Record<string, Field> = {
  ticket: 'ticket',
  'ticket id': 'ticket',
  order: 'ticket',
  position: 'ticket',
  deal: 'ticket',
  id: 'ticket',

  open: 'openAt',
  'open time': 'openAt',
  'open date': 'openAt',
  ouvrir: 'openAt',

  type: 'type',
  typ: 'type',
  action: 'type',

  volume: 'volume',
  lots: 'volume',
  size: 'volume',

  symbol: 'symbol',
  symbole: 'symbol',
  instrument: 'symbol',

  // `price` is resolved by occurrence: first is the entry, second is the exit.
  'open price': 'entryPrice',
  'entry price': 'entryPrice',
  'close price': 'exitPrice',
  'exit price': 'exitPrice',

  sl: 'stopLoss',
  's l': 'stopLoss',
  'stop loss': 'stopLoss',
  stoploss: 'stopLoss',

  tp: 'takeProfit',
  't p': 'takeProfit',
  'take profit': 'takeProfit',
  takeprofit: 'takeProfit',

  close: 'closeAt',
  'close time': 'closeAt',
  'close date': 'closeAt',
  fermeture: 'closeAt',

  swap: 'swap',
  swaps: 'swap',

  commission: 'commission',
  commissions: 'commission',

  profit: 'profit',
  'net profit': 'profit',
  'p l': 'profit',
  pnl: 'profit',

  pips: 'pips',

  duration: 'duration',
  'trade duration': 'duration',
  'trade duration in seconds': 'duration',
  'duree du trade en secondes': 'duration',
};

const PRICE_HEADERS = new Set(['price', 'prix']);

/**
 * `Type` values and the `DealKind` each becomes.
 *
 * The whole reason this table is explicit rather than "anything that is not buy or sell is a
 * trade": `listClosedTrades`, `realisedProfitBefore`, `countTrades` and `pageTrades` all
 * filter on `kind: 'trade'`, so a deposit that slips through as a trade is not caught by
 * anything downstream — it is simply added to net P&L, counted as a win, and given an
 * enormous R multiple. A `Type` this table does not know is a hard error for the same
 * reason.
 */
const DEAL_KINDS: Record<string, DealKind> = {
  buy: 'trade',
  sell: 'trade',
  'buy limit': 'trade',
  'sell limit': 'trade',
  'buy stop': 'trade',
  'sell stop': 'trade',
  balance: 'balance',
  deposit: 'balance',
  withdrawal: 'balance',
  withdraw: 'balance',
  payout: 'balance',
  credit: 'credit',
  correction: 'correction',
};

const SHORT_TYPES = new Set(['sell', 'sell limit', 'sell stop']);

export class FtmoParseError extends Error {
  readonly code:
    | 'empty-file'
    | 'unrecognised-header'
    | 'duplicate-column'
    | 'bad-row'
    | 'bad-number'
    | 'bad-date'
    | 'unknown-type';

  /** 1-based line number in the uploaded file, when the failure belongs to one row. */
  readonly line?: number;

  constructor(code: FtmoParseError['code'], message: string, line?: number) {
    super(message);
    this.name = 'FtmoParseError';
    this.code = code;
    this.line = line;
  }
}

export type FtmoParseOptions = {
  /**
   * The currency the FTMO account is denominated in — what `risk` is measured in.
   *
   * The export does not state it, and it cannot be inferred from the numbers. USD is FTMO's
   * default and by far its most common account currency, so that is the fallback; a caller
   * that knows better should say so, because a EUR account read as USD produces a risk
   * figure that is wrong by the EURUSD rate and an RR that is wrong with it.
   */
  accountCurrency?: string;
  /**
   * IANA zone the export's wall-clock times are written in.
   *
   * The file carries no offset at all — `2022-02-25 14:05:35` is broker-server time, which
   * for FTMO's MT4/MT5 servers is CE(S)T. Left at UTC the instants are shifted by an hour or
   * two, which changes nothing about P&L but does move the session and weekday dimensions.
   * The caller is the only one who can know it, so it is an option rather than a constant.
   */
  timeZone?: string;
  /** Passed straight through to `computeRr`, for symbols quoted in a third currency. */
  quoteRates?: Record<string, number>;
};

export type FtmoParseReport = {
  trades: TradeUpsert[];
  /** How the columns were resolved — worth surfacing, since one of these is a fallback. */
  layout: 'header' | 'positional' | 'headerless';
  delimiter: string;
  decimalSeparator: DecimalSeparator;
  /** Rows the file contained, excluding the header and any blank lines. */
  rows: number;
  warnings: string[];
};

/**
 * The import, in the shape the MT5 sync already writes.
 *
 * Returns `TradeUpsert[]` deliberately: everything downstream — `upsertTrades`, the
 * analytics loader, the trades table — is written against that type, and giving a CSV its
 * own parallel vocabulary would mean two definitions of what a trade is and two places to
 * fix when one of them is wrong.
 */
export function parseFtmoCsv(text: string, options: FtmoParseOptions = {}): TradeUpsert[] {
  return readFtmoCsv(text, options).trades;
}

/** As `parseFtmoCsv`, plus what had to be inferred to read the file. */
export function readFtmoCsv(text: string, options: FtmoParseOptions = {}): FtmoParseReport {
  const accountCurrency = (options.accountCurrency ?? 'USD').toUpperCase();
  const timeZone = options.timeZone ?? 'UTC';

  const delimiter = detectDelimiter(text);
  const allRows = splitDelimited(text, delimiter);

  // Row numbers are tracked against the original file so an error can name the line the
  // user would see if they opened it.
  const numbered = allRows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter((row) => !isBlankRow(row.cells));

  if (numbered.length === 0) {
    throw new FtmoParseError('empty-file', 'The file is empty — nothing to import.');
  }

  const warnings: string[] = [];
  const { columns, layout, dataRows } = resolveColumns(numbered, warnings);

  if (dataRows.length === 0) {
    throw new FtmoParseError(
      'empty-file',
      'The file has a header but no trades. Export the Trading Journal again with a date range that contains trades.',
    );
  }

  // Separators are decided once, from every numeric cell in the file, before a single value
  // is read. See `detectDecimalSeparator` for why per-cell detection cannot work.
  const decimalSeparator = detectDecimalSeparator(
    numericCells(
      dataRows.map((row) => row.cells),
      columns,
    ),
  );

  const parsed = dataRows.map((row) =>
    readRow(row.cells, row.line, columns, decimalSeparator, timeZone),
  );

  const deals = assignTickets(parsed);

  const trades = deals.map((deal) => {
    const { risk, rr, reason } = computeRr(deal, {
      accountCurrency,
      quoteRates: options.quoteRates,
      spec: findSymbolSpec(deal.symbol),
    });

    return {
      ticket: deal.ticket,
      kind: deal.kind,
      // Normalised, exactly as `aggregateDeals` does on the MetaApi path. The stored string is
      // what the symbol breakdown groups on and what the trades filter compares for equality,
      // so an unnormalised `eurusd.a` beside a synced `EURUSD` would read as two instruments
      // and a filter on either would miss half the book. Risk and asset class come out right
      // regardless, because those helpers normalise internally — which is what hides it.
      symbol: normalizeSymbol(deal.symbol),
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
      // Net, exactly as `toTradeRecords` in the MT5 sync stores it: the money that actually
      // moved. Every sum downstream assumes this and would double-count the costs otherwise.
      profit: deal.profit + deal.commission + deal.swap,
      risk,
      rr,
      // Why there is no risk, when there is none — `upsertTrades` uses it to tell a pricing
      // failure from a trade that genuinely had nothing at stake. A CSV import is a one-shot
      // write rather than a repeating sync, so it never protects an existing figure here; it
      // is passed because the field is not optional and a guess would be wrong somewhere else.
      riskReason: reason,
      // A CSV export carries results, not price history, so there is nothing to measure an
      // excursion from. Null is the honest answer and keeps these rows out of the MAE and MFE
      // aggregates rather than dragging them toward zero.
      mae: null,
      mfe: null,
    } satisfies TradeUpsert;
  });

  return {
    trades,
    layout,
    delimiter,
    decimalSeparator,
    rows: dataRows.length,
    warnings,
  };
}

/* --- columns ------------------------------------------------------------------------- */

type Columns = Partial<Record<Field, number>>;
type NumberedRow = { cells: string[]; line: number };

function normalizeHeader(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveColumns(
  rows: NumberedRow[],
  warnings: string[],
): { columns: Columns; layout: FtmoParseReport['layout']; dataRows: NumberedRow[] } {
  const first = rows[0] as NumberedRow;

  // A file whose very first row is already a trade has had its header stripped somewhere
  // between FTMO and here. Reading it positionally is safe precisely because the check
  // below is the same one that guards the fallback: it has to look like a trade.
  if (looksPositional(rows)) {
    warnings.push(
      'The file has no header row; columns were read by position, in FTMO MetriX order.',
    );
    return { columns: positionalColumns(first.cells.length), layout: 'headerless', dataRows: rows };
  }

  const dataRows = rows.slice(1);
  const byName = columnsFromHeader(first.cells);
  const missing = REQUIRED_FIELDS.filter((field) => byName[field] === undefined);

  if (missing.length === 0) return { columns: byName, layout: 'header', dataRows };

  // Names failed. Fall back to position only on strong evidence — the right number of
  // columns *and* data rows that actually read as FTMO trades. Anything weaker is a guess,
  // and a guess here produces a believable account rather than an error.
  if (looksPositional(dataRows)) {
    warnings.push(
      `Header not recognised (${missing.join(', ')} missing); columns were read by position, in FTMO MetriX order. Check a few rows against the Client Area before trusting the numbers.`,
    );
    return {
      columns: positionalColumns(first.cells.length),
      layout: 'positional',
      dataRows,
    };
  }

  throw new FtmoParseError(
    'unrecognised-header',
    [
      'This does not look like an FTMO MetriX Trading Journal export.',
      `Missing columns: ${missing.join(', ')}.`,
      `Header found: ${first.cells.join(' | ')}`,
      'Expected: Ticket;Open;Type;Volume;Symbol;Price;SL;TP;Close;Price;Swap;Commissions;Profit;Pips;"Trade duration in seconds"',
      'Export it from Client Area → Accounts Overview → MetriX → Trading Journal → Export → CSV, and upload the file unedited.',
    ].join('\n'),
    first.line,
  );
}

function columnsFromHeader(header: string[]): Columns {
  const columns: Columns = {};
  let priceSeen = 0;

  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);

    // The duplicated `Price`: first occurrence is the entry, second is the exit. Resolving
    // it by order is the only thing that can work — the two cells are named identically.
    if (PRICE_HEADERS.has(name)) {
      const field: Field = priceSeen === 0 ? 'entryPrice' : 'exitPrice';
      priceSeen++;
      if (priceSeen > 2) {
        throw new FtmoParseError(
          'duplicate-column',
          `Found ${priceSeen} "Price" columns; the FTMO export has exactly two (entry, then exit).`,
        );
      }
      if (columns[field] === undefined) columns[field] = index;
      return;
    }

    const field = HEADER_ALIASES[name];
    // First occurrence wins, so a trailing repeat of a column cannot shadow the real one.
    if (field !== undefined && columns[field] === undefined) columns[field] = index;
  });

  return columns;
}

function positionalColumns(width: number): Columns {
  const columns: Columns = {};
  FTMO_COLUMN_ORDER.forEach((field, index) => {
    if (index < width) columns[field] = index;
  });
  return columns;
}

/**
 * Whether these rows read as FTMO trades laid out in the documented order.
 *
 * All three conditions have to hold on the first row: the ticket is present, the type is one
 * this parser knows, and both timestamps parse. That is specific enough that a CSV from
 * somewhere else effectively cannot pass it, which is what makes the positional fallback a
 * reading rather than a guess.
 */
function looksPositional(rows: NumberedRow[]): boolean {
  const row = rows[0];
  if (!row || row.cells.length < FTMO_COLUMN_ORDER.length - 2) return false;

  const cells = row.cells;
  if ((cells[0] ?? '').trim() === '') return false;
  if (DEAL_KINDS[normalizeHeader(cells[2] ?? '')] === undefined) return false;

  return parseTimestamp(cells[1] ?? '') !== null && parseTimestamp(cells[8] ?? '') !== null;
}

function* numericCells(rows: string[][], columns: Columns): Generator<string> {
  for (const row of rows) {
    for (const field of NUMERIC_FIELDS) {
      const index = columns[field];
      if (index === undefined) continue;
      const cell = row[index];
      if (cell !== undefined) yield cell;
    }
  }
}

/* --- rows ---------------------------------------------------------------------------- */

function readRow(
  cells: string[],
  line: number,
  columns: Columns,
  decimal: DecimalSeparator,
  timeZone: string,
): Mt5Deal {
  const raw = (field: Field): string => {
    const index = columns[field];
    return index === undefined ? '' : (cells[index] ?? '').trim();
  };

  // Only the columns a trade cannot do without. Trailing optional cells (Pips, Duration) are
  // allowed to be absent, because some tools drop empty trailing fields when re-saving; a
  // missing *price* column is corruption and has to stop the import.
  const widest = REQUIRED_FIELDS.reduce((max, field) => Math.max(max, columns[field] ?? -1), -1);
  if (cells.length <= widest) {
    throw new FtmoParseError(
      'bad-row',
      `Line ${line} has ${cells.length} columns but at least ${widest + 1} are needed. The file looks truncated or edited.`,
      line,
    );
  }

  const typeName = normalizeHeader(raw('type'));
  const kind = DEAL_KINDS[typeName];
  if (kind === undefined) {
    throw new FtmoParseError(
      'unknown-type',
      `Line ${line}: unrecognised Type "${raw('type')}". Expected one of ${Object.keys(DEAL_KINDS).join(', ')}.`,
      line,
    );
  }

  const number = (field: Field, fallback: number | null = null): number | null => {
    const cell = raw(field);
    if (cell === '') return fallback;
    const value = parseNumber(cell, decimal);
    if (value === null) {
      throw new FtmoParseError(
        'bad-number',
        `Line ${line}: could not read "${cell}" in the ${field} column as a number.`,
        line,
      );
    }
    return value;
  };

  const date = (field: Field, required: boolean): Date | null => {
    const cell = raw(field);
    if (cell === '') {
      if (!required) return null;
      throw new FtmoParseError('bad-date', `Line ${line}: the ${field} column is empty.`, line);
    }
    const wall = parseTimestamp(cell);
    if (wall === null) {
      throw new FtmoParseError(
        'bad-date',
        `Line ${line}: could not read "${cell}" as a date. Expected something like 2022-02-25 14:05:35.`,
        line,
      );
    }
    return instantOf(wall, timeZone);
  };

  const openAt = date('openAt', true) as Date;
  const closeAt = date('closeAt', false);

  // A close before its open means the day and month were read the wrong way round — the one
  // date failure that produces valid Dates and a silently wrong journal.
  if (closeAt && closeAt.getTime() < openAt.getTime()) {
    throw new FtmoParseError(
      'bad-date',
      `Line ${line}: the close time is before the open time (${raw('openAt')} → ${raw('closeAt')}). The file's date format could not be read unambiguously.`,
      line,
    );
  }

  if (kind !== 'trade') {
    // Balance operations carry the amount in Profit and nothing else meaningful. Shaped
    // exactly like the deposit the mock provider emits, so the balance view and the
    // analytics exclusion behave identically whichever source the row came from.
    return {
      ticket: raw('ticket'),
      kind,
      symbol: '',
      direction: 'long',
      volume: 0,
      openAt,
      closeAt: closeAt ?? openAt,
      entryPrice: 0,
      exitPrice: null,
      stopLoss: null,
      takeProfit: null,
      commission: 0,
      swap: 0,
      profit: number('profit', 0) as number,
    };
  }

  const symbol = raw('symbol');
  if (symbol === '') {
    throw new FtmoParseError('bad-row', `Line ${line}: a ${typeName} row has no symbol.`, line);
  }

  const direction: Direction = SHORT_TYPES.has(typeName) ? 'short' : 'long';

  return {
    ticket: raw('ticket'),
    kind,
    symbol,
    direction,
    volume: number('volume', 0) as number,
    openAt,
    closeAt,
    entryPrice: number('entryPrice', 0) as number,
    // A still-open position has no exit; a closed one always does.
    exitPrice: closeAt === null ? null : number('exitPrice'),
    // MT5 writes an unset stop or target as 0.0, not as an empty cell. Carrying that through
    // literally would turn "no stop loss" into "stop at zero", which is a real distance from
    // the entry and therefore a real, entirely fictional risk figure.
    stopLoss: zeroAsNull(number('stopLoss')),
    takeProfit: zeroAsNull(number('takeProfit')),
    commission: number('commission', 0) as number,
    swap: number('swap', 0) as number,
    profit: number('profit', 0) as number,
  };
}

const zeroAsNull = (value: number | null): number | null =>
  value === null || value === 0 ? null : value;

/**
 * Day or swing, by the same calendar rule the MT5 sync applies (see `styleOf` in
 * src/lib/mt5/sync.ts): decided in the analytics timezone, not by elapsed hours, so a trade
 * imported from a CSV lands on the same calendar square as the same trade synced from the
 * broker.
 */
function styleOf(deal: Mt5Deal): 'day' | 'swing' {
  if (!deal.closeAt) return 'day';
  return sameZonedDay(deal.openAt, deal.closeAt, ANALYTICS_TIME_ZONE) ? 'day' : 'swing';
}

/* --- tickets ------------------------------------------------------------------------- */

/**
 * The idempotency key.
 *
 * `upsertTrades` is keyed on `(user_id, ticket)`, so whatever goes in here decides what
 * happens when the same file is uploaded twice — and it will be, because the natural way to
 * keep an imported journal current is to export a fresh, overlapping CSV every week.
 *
 * **The broker's own ticket, verbatim.** It is already the account-unique identifier MT5
 * assigns to a position, it is what the `Mt5Deal.ticket` contract means, and it is what the
 * MetaApi sync writes for the very same trade. Re-importing a file therefore updates rather
 * than duplicates, and a trader who later connects the account by API converges onto the
 * same rows instead of ending up with two copies of every trade. Hashing the row's contents
 * instead would have been stable too, but it would break both of those properties: a broker
 * re-booking a swap a day later changes the row, and a changed row would become a second
 * trade.
 *
 * Two edges the raw ticket does not cover on its own:
 *
 *   - **A row with no ticket.** Synthesised from a hash of the row's identifying fields, so
 *     it is deterministic across re-imports of the same file. Prefixed `ftmo-` so its origin
 *     is obvious in the database.
 *   - **A ticket appearing more than once**, which a position closed in parts produces: one
 *     row per exit, all carrying the position's ticket. These are **merged into one trade**,
 *     because that is what the rest of the system already means by a trade — `aggregateDeals`
 *     in the MetaApi provider folds every exit of a position into a single row in exactly the
 *     same way, summing the money and taking the last exit. Suffixing each leg instead was
 *     the first thing tried here and is a trap: whether a row got a suffix then depended on
 *     what *else* was in the file, so a January export wrote ticket `123` and a February
 *     export covering the same period wrote `123-a1b2` and `123-c3d4`. `upsertTrades` never
 *     deletes, so the January row survived as a third copy and its profit was counted twice
 *     in every total, with nothing on screen looking wrong.
 */
function assignTickets(deals: Mt5Deal[]): Mt5Deal[] {
  const byTicket = new Map<string, Mt5Deal[]>();
  const order: string[] = [];

  for (const deal of deals) {
    const ticket =
      deal.ticket === ''
        ? `ftmo-${stableHash([
            deal.kind,
            deal.symbol,
            deal.direction,
            String(deal.volume),
            deal.openAt.toISOString(),
            deal.closeAt?.toISOString() ?? '',
            String(deal.entryPrice),
            String(deal.exitPrice ?? ''),
            String(deal.profit),
          ])}`
        : deal.ticket;

    const group = byTicket.get(ticket);
    if (group) group.push({ ...deal, ticket });
    else {
      byTicket.set(ticket, [{ ...deal, ticket }]);
      order.push(ticket);
    }
  }

  return order.map((ticket) => mergeLegs(byTicket.get(ticket)!));
}

/**
 * Folds the exits of one position into the single trade the journal stores.
 *
 * Mirrors `aggregateDeals`: earliest open, latest close, the entry price from the leg that
 * opened and the exit price from the leg that closed last, and every money column summed.
 * Volume is summed too — each row carries the volume that leg closed, so the total is the
 * position the trader actually opened, which is what risk is computed against.
 */
function mergeLegs(legs: Mt5Deal[]): Mt5Deal[][number] {
  if (legs.length === 1) return legs[0]!;

  const byOpen = [...legs].sort((a, b) => a.openAt.getTime() - b.openAt.getTime());
  const byClose = [...legs].sort(
    (a, b) => (a.closeAt?.getTime() ?? 0) - (b.closeAt?.getTime() ?? 0),
  );
  const first = byOpen[0]!;
  const last = byClose[byClose.length - 1]!;
  const sum = (pick: (deal: Mt5Deal) => number) => legs.reduce((total, d) => total + pick(d), 0);

  return {
    ...first,
    closeAt: last.closeAt,
    exitPrice: last.exitPrice,
    volume: sum((d) => d.volume),
    commission: sum((d) => d.commission),
    swap: sum((d) => d.swap),
    profit: sum((d) => d.profit),
    // A stop removed before the last exit leaves no trace; the first one set is the plan.
    stopLoss: legs.find((d) => d.stopLoss !== null)?.stopLoss ?? null,
    takeProfit: legs.find((d) => d.takeProfit !== null)?.takeProfit ?? null,
  };
}

/* --- dates --------------------------------------------------------------------------- */

type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// `2022-02-25 14:05:35`, `2025.03.10 09:35:12`, `2025/03/10T09:35`, with or without seconds.
const YEAR_FIRST = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/;
// `25.02.2022 14:05:35` — the localised form, day first.
const DAY_FIRST = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/;

/**
 * Reads a timestamp as wall-clock components, or null.
 *
 * FTMO's own export writes `YYYY-MM-DD HH:MM:SS`; MT5's own writes `YYYY.MM.DD HH:MM:SS`.
 * Both are unambiguous and both are accepted. The day-first form is accepted too because a
 * localised export could plausibly use it — with the caveat, documented here rather than
 * discovered later, that `03.04.2025` is read as 3 April. If a US-style file ever turns up
 * it will either be caught by the close-before-open check or, in the rare case it is not,
 * read a day out; year-first is the only form we have actually seen.
 */
export function parseTimestamp(raw: string): WallTime | null {
  const value = raw.trim();
  if (value === '') return null;

  let year: number;
  let month: number;
  let day: number;
  let rest: (string | undefined)[];

  const iso = YEAR_FIRST.exec(value);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    rest = [iso[4], iso[5], iso[6]];
  } else {
    const dmy = DAY_FIRST.exec(value);
    if (!dmy) return null;
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
    // The one disambiguation that is not a guess: a "month" above twelve is a day, so the
    // file is month-first after all.
    if (month > 12 && day <= 12) {
      const swap = day;
      day = month;
      month = swap;
    }
    rest = [dmy[4], dmy[5], dmy[6]];
  }

  const hour = rest[0] === undefined ? 0 : Number(rest[0]);
  const minute = rest[1] === undefined ? 0 : Number(rest[1]);
  const second = rest[2] === undefined ? 0 : Number(rest[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return { year, month, day, hour, minute, second };
}

/**
 * Wall-clock reading → instant.
 *
 * `fromWallClock` is the codebase's one implementation of "what instant did this clock
 * read", DST history included, so it is reused rather than re-derived. It works to the
 * minute; the seconds are added afterwards, which is exact because every IANA offset is a
 * whole number of minutes — and they matter, since a scalp that opens and closes inside the
 * same minute would otherwise have no duration at all.
 */
function instantOf(wall: WallTime, timeZone: string): Date {
  if (timeZone === 'UTC') {
    return new Date(
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
    );
  }
  const minutePrecision = fromWallClock(
    { year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute },
    timeZone,
  );
  return new Date(minutePrecision.getTime() + wall.second * 1000);
}
