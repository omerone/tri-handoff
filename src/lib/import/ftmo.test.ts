import { describe, expect, it } from 'vitest';
import type { TradeUpsert } from '@/lib/db/trades';
import { FtmoParseError, parseFtmoCsv, parseTimestamp, readFtmoCsv } from './ftmo';

/**
 * The fixtures below are the real thing.
 *
 * `REAL_EXPORT` is copied verbatim — header, quoting, ordering and all — from a genuine
 * FTMO MetriX Trading Journal export published with an FTMO analysis tool. Every other
 * fixture is a deliberate mutation of it, so a test that fails points at the mutation
 * rather than at a fixture nobody can check against reality.
 */
const HEADER =
  'Ticket;Open;Type;Volume;Symbol;Price;SL;TP;Close;Price;Swap;Commissions;Profit;Pips;"Trade duration in seconds"';

const REAL_EXPORT = [
  HEADER,
  '114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
  '113667493;"2022-02-24 15:52:26";sell;10.00;ETHUSD;2401.44;2395;2383;"2022-02-24 16:05:52";2394.24;0;-0.96;72;7.2;806',
  '113160938;"2022-02-23 17:54:23";buy;0.01;EURUSD;1.13236;0;0;"2022-02-23 17:56:17";1.13227;0;-0.03;-0.09;-0.9;114',
  '',
].join('\n');

const byTicket = (trades: TradeUpsert[]): Map<string, TradeUpsert> =>
  new Map(trades.map((trade) => [trade.ticket, trade]));

describe('parseFtmoCsv, against a real FTMO MetriX export', () => {
  const trades = parseFtmoCsv(REAL_EXPORT);

  it('reads every trade row and nothing else', () => {
    expect(trades).toHaveLength(3);
  });

  it('keeps the broker ticket verbatim', () => {
    expect(trades.map((trade) => trade.ticket)).toEqual(['114080575', '113667493', '113160938']);
  });

  it('reads the two identically-named Price columns as entry then exit', () => {
    // The single most dangerous thing about this file. A header-keyed reader that keeps the
    // last duplicate would put 38835.23 in both, which shows up as a trade that made money
    // going nowhere rather than as an error.
    const btc = trades[0] as TradeUpsert;
    expect(btc.entryPrice).toBe(38878.28);
    expect(btc.exitPrice).toBe(38835.23);
  });

  it('maps buy and sell to long and short', () => {
    expect(trades.map((trade) => trade.direction)).toEqual(['short', 'short', 'long']);
  });

  it('reads the timestamps, seconds included', () => {
    const btc = trades[0] as TradeUpsert;
    expect(btc.openAt.toISOString()).toBe('2022-02-25T14:05:35.000Z');
    expect(btc.closeAt?.toISOString()).toBe('2022-02-25T14:06:03.000Z');
  });

  it('classifies the symbol through the pipeline the sync uses', () => {
    expect(trades.map((trade) => trade.assetClass)).toEqual(['crypto', 'crypto', 'forex']);
  });

  it('files everything opened and closed on one calendar day as a day trade', () => {
    expect(trades.every((trade) => trade.style === 'day')).toBe(true);
  });

  it('stores profit net of commission and swap, as the sync does', () => {
    // Gross 430.5, commission -15.55, swap 0.
    expect((trades[0] as TradeUpsert).profit).toBeCloseTo(414.95, 10);
    expect((trades[0] as TradeUpsert).commission).toBe(-15.55);
    expect((trades[0] as TradeUpsert).swap).toBe(0);

    expect((trades[1] as TradeUpsert).profit).toBeCloseTo(71.04, 10);
    expect((trades[2] as TradeUpsert).profit).toBeCloseTo(-0.12, 10);
  });

  it('reads an unset stop or target — which MT5 writes as 0 — as no stop at all', () => {
    // Carried through literally, a stop of 0.0 on BTCUSD is a 38,878-point distance and a
    // risk figure of nearly four hundred thousand dollars. Plausible-looking nonsense is
    // exactly what this null is here to prevent.
    const btc = trades[0] as TradeUpsert;
    expect(btc.stopLoss).toBeNull();
    expect(btc.takeProfit).toBeNull();
    expect(btc.risk).toBeNull();
    expect(btc.rr).toBeNull();
  });

  /**
   * The stop is carried through, and it still yields no risk — because of where it sits.
   *
   * This row is a **sell** at 2401.44 with its stop at 2395, which is *below* the entry: for a
   * short that is not a loss, it is a locked-in profit, and the position closed at 2394.24
   * just past it. `computeRisk` signs the distance by the side the position faced, so this is
   * `stop-beyond-entry` rather than a 64.40 risk and a 1.10 RR.
   *
   * That this appears in a real twenty-seven-row export, and again on the live FTMO account
   * where a trailed USOIL stop produced a headline of 213.66R, is the whole argument for the
   * rule: trailing a stop to breakeven is ordinary trading, and measuring it as `|entry − stop|`
   * turns the most disciplined exits into the most spectacular R multiples.
   */
  it('gives no RR to a stop that had been trailed past the entry', () => {
    const eth = trades[1] as TradeUpsert;
    expect(eth.stopLoss).toBe(2395);
    expect(eth.takeProfit).toBe(2383);
    expect(eth.direction).toBe('short');
    expect(eth.risk).toBeNull();
    expect(eth.rr).toBeNull();
  });

  it('reports how it read the file', () => {
    const report = readFtmoCsv(REAL_EXPORT);
    expect(report.layout).toBe('header');
    expect(report.delimiter).toBe(';');
    expect(report.decimalSeparator).toBe('.');
    expect(report.rows).toBe(3);
    expect(report.warnings).toEqual([]);
  });
});

describe('deposits, withdrawals and other balance operations', () => {
  const withCashFlow = [
    HEADER,
    '500001;"2022-02-01 09:00:00";balance;0;;0;0;0;"2022-02-01 09:00:00";0;0;0;100000;0;0',
    '500002;"2022-02-28 17:00:00";withdrawal;0;;0;0;0;"2022-02-28 17:00:00";0;0;0;-8500.25;0;0',
    '114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
  ].join('\n');

  const trades = parseFtmoCsv(withCashFlow);

  it("never files a cash movement as a trade", () => {
    // `listClosedTrades`, `countTrades`, `pageTrades` and `realisedProfitBefore` all filter
    // on kind === 'trade'. A deposit that slips through is not caught anywhere downstream:
    // it is simply added to net P&L and counted as the best winning trade of the month.
    expect(trades.map((trade) => trade.kind)).toEqual(['balance', 'balance', 'trade']);
  });

  it('carries the amount in profit and leaves the trade fields empty', () => {
    const deposit = trades[0] as TradeUpsert;
    expect(deposit.profit).toBe(100000);
    expect(deposit.symbol).toBe('');
    expect(deposit.volume).toBe(0);
    expect(deposit.entryPrice).toBe(0);
    expect(deposit.exitPrice).toBeNull();
    expect(deposit.stopLoss).toBeNull();
    expect(deposit.risk).toBeNull();
    expect(deposit.rr).toBeNull();
  });

  it('keeps a withdrawal negative', () => {
    expect((trades[1] as TradeUpsert).profit).toBe(-8500.25);
  });

  it('accepts the other MT5 balance-operation names', () => {
    const kinds = ['deposit', 'payout', 'credit', 'correction'].map((type) => {
      const csv = [
        HEADER,
        `9;"2022-02-01 09:00:00";${type};0;;0;0;0;"2022-02-01 09:00:00";0;0;0;10;0;0`,
      ].join('\n');
      return (parseFtmoCsv(csv)[0] as TradeUpsert).kind;
    });
    expect(kinds).toEqual(['balance', 'balance', 'credit', 'correction']);
  });

  it('refuses a Type it does not recognise rather than defaulting it to a trade', () => {
    const csv = [
      HEADER,
      '9;"2022-02-01 09:00:00";rebate;0;;0;0;0;"2022-02-01 09:00:00";0;0;0;10;0;0',
    ].join('\n');
    expect(() => parseFtmoCsv(csv)).toThrow(FtmoParseError);
    expect(() => parseFtmoCsv(csv)).toThrow(/unrecognised Type "rebate"/i);
  });
});

describe('ticket stability and re-import', () => {
  it('produces identical output for the same file parsed twice', () => {
    expect(parseFtmoCsv(REAL_EXPORT)).toEqual(parseFtmoCsv(REAL_EXPORT));
  });

  it('gives an overlapping re-export the same tickets, so the upsert updates rather than duplicates', () => {
    // What actually happens in a month's time: the trader exports again, the file contains
    // everything it did before plus whatever is new, and it is uploaded over the top. Under
    // the (user_id, ticket) key the old rows have to land on themselves.
    const later = [
      HEADER,
      '115999001;"2022-03-02 10:00:00";buy;1.00;XAUUSD;1900.10;1895;1920;"2022-03-02 12:30:00";1907.40;0;-3.50;730;73;9000',
      ...REAL_EXPORT.split('\n').slice(1),
    ].join('\n');

    const first = byTicket(parseFtmoCsv(REAL_EXPORT));
    const second = byTicket(parseFtmoCsv(later));

    expect(second.size).toBe(first.size + 1);
    for (const [ticket, trade] of first) {
      expect(second.get(ticket)).toEqual(trade);
    }
  });

  it('keeps the ticket when the broker restates a row after the fact', () => {
    // Swap is sometimes booked a day late — the same reason the MT5 sync re-reads a two-day
    // overlap. A ticket derived from the row's contents would turn the restated row into a
    // second trade; the broker's own ticket cannot.
    const restated = REAL_EXPORT.replace(
      '38835.23;0;-15.55;430.5',
      '38835.23;-1.25;-15.55;430.5',
    );
    const before = parseFtmoCsv(REAL_EXPORT)[0] as TradeUpsert;
    const after = parseFtmoCsv(restated)[0] as TradeUpsert;

    expect(after.ticket).toBe(before.ticket);
    expect(after.swap).toBe(-1.25);
    expect(after.profit).toBeCloseTo(413.7, 10);
  });

  it('folds the legs of a partially-closed position into one trade, keeping all the money', () => {
    // One position closed in two parts reports its ticket twice. The MetaApi provider folds a
    // position's exits into a single row, and so does this — same trade, same meaning, from
    // either source.
    const partials = [
      HEADER,
      '777;"2022-02-25 14:05:35";sell;5.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-7.00;215.0;21.5;28',
      '777;"2022-02-25 14:05:35";sell;5.00;BTCUSD;38878.28;0;0;"2022-02-25 14:09:41";38800.00;0;-7.00;391.4;39.1;246',
    ].join('\n');

    const trades = parseFtmoCsv(partials);
    expect(trades).toHaveLength(1);

    const merged = trades[0] as TradeUpsert;
    expect(merged.ticket).toBe('777');
    // Nothing is dropped: both legs' volume, costs and P&L are in the one row.
    expect(merged.volume).toBe(10);
    expect(merged.commission).toBeCloseTo(-14, 10);
    expect(merged.profit).toBeCloseTo(215.0 + 391.4 - 14, 10);
    // Closed by the last exit, priced at the last exit.
    expect(merged.closeAt?.toISOString()).toContain('14:09:41');
    expect(merged.exitPrice).toBe(38800);

    // Order of the rows in the file changes nothing.
    const reversed = [HEADER, ...partials.split('\n').slice(1).reverse()].join('\n');
    expect(parseFtmoCsv(reversed)).toEqual(trades);
  });

  /**
   * The regression that made merging the right answer rather than a preference.
   *
   * A suffix applied only to tickets that repeat *within one file* makes a row's identity
   * depend on its neighbours. Export in January, get `777`. Export again in February with the
   * period overlapping, the position has since been closed in parts, and the same January leg
   * now writes `777-<hash>`. `upsertTrades` never deletes, so the journal keeps all of them
   * and counts that leg's profit twice.
   */
  it('keeps one row for a position across two overlapping exports', () => {
    const january = [
      HEADER,
      '777;"2022-02-25 14:05:35";sell;5.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-7.00;215.0;21.5;28',
    ].join('\n');
    const february = [
      january,
      '777;"2022-02-25 14:05:35";sell;5.00;BTCUSD;38878.28;0;0;"2022-02-25 14:09:41";38800.00;0;-7.00;391.4;39.1;246',
    ].join('\n');

    const first = parseFtmoCsv(january);
    const second = parseFtmoCsv(february);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // The same key both times, so the second import updates the first row instead of adding to it.
    expect(second[0]?.ticket).toBe(first[0]?.ticket);
  });

  it('synthesises a deterministic ticket for a row that has none', () => {
    const noTicket = [
      HEADER,
      ';"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');

    const once = parseFtmoCsv(noTicket)[0] as TradeUpsert;
    const twice = parseFtmoCsv(noTicket)[0] as TradeUpsert;
    expect(once.ticket).toMatch(/^ftmo-[0-9a-f]{16}$/);
    expect(twice.ticket).toBe(once.ticket);
  });
});

describe('separators, dates and file quirks', () => {
  it('reads a comma-decimal, dot-dated export', () => {
    // The shape a localised Client Area produces: MT5-style dates and European decimals.
    const european = [
      'Ticket;Open;Type;Volume;Symbol;Price;S/L;T/P;Close;Price;Swap;Commissions;Profit;Pips;Duration',
      '10001;2025.03.10 09:35:12;buy;0,20;EURUSD;1,08520;0;0;2025.03.10 10:05:40;1,08610;0,00;-1,20;18,00;9;1828',
    ].join('\n');

    const trade = parseFtmoCsv(european)[0] as TradeUpsert;
    expect(trade.volume).toBe(0.2);
    expect(trade.entryPrice).toBe(1.0852);
    expect(trade.exitPrice).toBe(1.0861);
    expect(trade.commission).toBe(-1.2);
    expect(trade.profit).toBeCloseTo(16.8, 10);
    expect(trade.openAt.toISOString()).toBe('2025-03-10T09:35:12.000Z');
    expect(readFtmoCsv(european).decimalSeparator).toBe(',');
  });

  it('strips thousands separators from a large profit', () => {
    const big = [
      HEADER,
      '1;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38 878,28;0;0;"2022-02-25 14:06:03";38 835,23;0,00;-15,55;12 430,50;43,05;28',
    ].join('\n');
    const trade = parseFtmoCsv(big)[0] as TradeUpsert;
    expect(trade.entryPrice).toBe(38878.28);
    expect(trade.profit).toBeCloseTo(12414.95, 10);
  });

  it('survives a BOM, CRLF endings and a comma-delimited Excel re-save', () => {
    const excel = [
      'Ticket,Open,Type,Volume,Symbol,Price,SL,TP,Close,Price,Swap,Commissions,Profit,Pips,Trade duration in seconds',
      '114080575,"2022-02-25 14:05:35",sell,10.00,BTCUSD,38878.28,0,0,"2022-02-25 14:06:03",38835.23,0,-15.55,430.5,43.05,28',
    ].join('\r\n');

    const report = readFtmoCsv(`﻿${excel}\r\n`);
    expect(report.delimiter).toBe(',');
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]?.entryPrice).toBe(38878.28);
  });

  it('reinterprets the wall clock in the broker server zone when told to', () => {
    // The export carries no offset at all; FTMO's MT4/MT5 servers run on CE(S)T. Left at UTC
    // the P&L is right and the session dimension is an hour or two out.
    const trade = parseFtmoCsv(REAL_EXPORT, { timeZone: 'Europe/Prague' })[0] as TradeUpsert;
    // 2022-02-25 is winter — CET, UTC+1 — and the seconds survive the conversion.
    expect(trade.openAt.toISOString()).toBe('2022-02-25T13:05:35.000Z');
  });

  it('marks a position held across a calendar boundary as a swing trade', () => {
    const overnight = [
      HEADER,
      '1;"2022-02-24 21:00:00";buy;1.00;XAUUSD;1900.00;1890;0;"2022-02-25 09:30:00";1910.00;-2.10;-3.50;1000;100;45000',
    ].join('\n');
    expect((parseFtmoCsv(overnight)[0] as TradeUpsert).style).toBe('swing');
  });

  it('treats a row with no close as an open position', () => {
    const open = [
      HEADER,
      '1;"2022-02-25 14:05:35";buy;1.00;XAUUSD;1900.00;1890;1920;;;0;-3.50;0;0;0',
    ].join('\n');
    const trade = parseFtmoCsv(open)[0] as TradeUpsert;
    expect(trade.closeAt).toBeNull();
    expect(trade.exitPrice).toBeNull();
    expect(trade.style).toBe('day');
  });

  it('measures risk in the account currency it is given', () => {
    const csv = [
      HEADER,
      '1;"2022-02-25 14:05:35";buy;1.00;GER40;15000.0;14900;0;"2022-02-25 16:00:00";15050.0;0;0;50;0;6000',
    ].join('\n');

    // GER40 is quoted in euros. On a EUR account the distance is the risk; on a USD account
    // it cannot be converted without a rate, and no RR is the honest answer.
    const euro = parseFtmoCsv(csv, { accountCurrency: 'EUR' })[0] as TradeUpsert;
    expect(euro.risk).toBeCloseTo(100, 6);

    const dollar = parseFtmoCsv(csv, { accountCurrency: 'USD' })[0] as TradeUpsert;
    expect(dollar.risk).toBeNull();

    const converted = parseFtmoCsv(csv, {
      accountCurrency: 'USD',
      quoteRates: { EURUSD: 1.1 },
    })[0] as TradeUpsert;
    expect(converted.risk).toBeCloseTo(110, 6);
  });
});

describe('headers it has never seen', () => {
  it('reads FTMO’s French headers by name', () => {
    const french = [
      'Ticket;Ouvrir;Type;Volume;Symbole;Prix;SL;TP;Fermeture;Prix;Swap;Commissions;Profit;Pips;"Durée du trade en secondes"',
      '114080575;"2022-02-25 14:05:35";sell;10,00;BTCUSD;38878,28;0;0;"2022-02-25 14:06:03";38835,23;0;-15,55;430,5;43,05;28',
    ].join('\n');

    const report = readFtmoCsv(french);
    expect(report.layout).toBe('header');
    expect(report.trades[0]?.entryPrice).toBe(38878.28);
    expect(report.trades[0]?.exitPrice).toBe(38835.23);
  });

  it('falls back to column order for a localisation it cannot read, and says so', () => {
    // Guarded, not guessed: the fallback only engages when the row count is right *and* the
    // data rows read as FTMO trades — a ticket, a known Type, two parseable timestamps.
    const czech = [
      'Tiket;Otevřít;Typ;Objem;Symbol;Cena;SL;TP;Zavřít;Cena;Swap;Komise;Zisk;Pipy;"Doba obchodu v sekundách"',
      '114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');

    const report = readFtmoCsv(czech);
    expect(report.layout).toBe('positional');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/read by position/i);
    expect(report.trades[0]?.entryPrice).toBe(38878.28);
    expect(report.trades[0]?.profit).toBeCloseTo(414.95, 10);
  });

  it('reads a file whose header row was stripped on the way here', () => {
    const headerless = REAL_EXPORT.split('\n').slice(1).join('\n');
    const report = readFtmoCsv(headerless);
    expect(report.layout).toBe('headerless');
    expect(report.trades).toHaveLength(3);
    expect(report.trades[0]?.ticket).toBe('114080575');
  });
});

describe('malformed files', () => {
  it('rejects an empty file', () => {
    expect(() => parseFtmoCsv('')).toThrow(/empty/i);
    expect(() => parseFtmoCsv('   \n\n')).toThrow(/empty/i);
  });

  it('rejects a header with no trades under it', () => {
    expect(() => parseFtmoCsv(`${HEADER}\n`)).toThrow(/no trades/i);
  });

  it('rejects a completely different CSV, naming what is missing and what was expected', () => {
    const wrong = ['Date,Description,Amount', '2022-02-25,Coffee,-3.40'].join('\n');

    let thrown: unknown;
    try {
      parseFtmoCsv(wrong);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FtmoParseError);
    const error = thrown as FtmoParseError;
    expect(error.code).toBe('unrecognised-header');
    // The message has to be enough to act on without opening the source.
    expect(error.message).toMatch(/Missing columns:.*ticket/);
    expect(error.message).toContain('Date | Description | Amount');
    expect(error.message).toContain('Ticket;Open;Type;Volume;Symbol');
    expect(error.message).toMatch(/MetriX/);
  });

  it('will not fall back to column order for a file that merely has fifteen columns', () => {
    const impostor = [
      'a;b;c;d;e;f;g;h;i;j;k;l;m;n;o',
      '1;2;3;4;5;6;7;8;9;10;11;12;13;14;15',
    ].join('\n');
    expect(() => parseFtmoCsv(impostor)).toThrow(FtmoParseError);
    expect(() => parseFtmoCsv(impostor)).toThrow(/does not look like an FTMO/i);
  });

  it('rejects a truncated row and names the line', () => {
    const truncated = [
      HEADER,
      '114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;38878.28;0;0',
    ].join('\n');

    let thrown: unknown;
    try {
      parseFtmoCsv(truncated);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as FtmoParseError).code).toBe('bad-row');
    expect((thrown as FtmoParseError).line).toBe(2);
    expect((thrown as Error).message).toMatch(/Line 2/);
  });

  it('rejects a price that is not a number rather than reading it as zero', () => {
    const garbled = [
      HEADER,
      '114080575;"2022-02-25 14:05:35";sell;10.00;BTCUSD;n/a;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');
    expect(() => parseFtmoCsv(garbled)).toThrow(/entryPrice/);
    expect(() => parseFtmoCsv(garbled)).toThrow(/Line 2/);
  });

  it('rejects an unreadable date', () => {
    const garbled = [
      HEADER,
      '114080575;"yesterday";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');
    let thrown: unknown;
    try {
      parseFtmoCsv(garbled);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as FtmoParseError).code).toBe('bad-date');
    expect((thrown as Error).message).toMatch(/2022-02-25 14:05:35/);
  });

  it('rejects a close that precedes its open, which is what a misread date format looks like', () => {
    const backwards = [
      HEADER,
      '1;"2022-02-25 14:06:03";sell;10.00;BTCUSD;38878.28;0;0;"2022-02-25 14:05:35";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');
    expect(() => parseFtmoCsv(backwards)).toThrow(/close time is before the open time/i);
  });

  it('rejects a trade row with no symbol', () => {
    const nameless = [
      HEADER,
      '1;"2022-02-25 14:05:35";sell;10.00;;38878.28;0;0;"2022-02-25 14:06:03";38835.23;0;-15.55;430.5;43.05;28',
    ].join('\n');
    expect(() => parseFtmoCsv(nameless)).toThrow(/no symbol/i);
  });
});

describe('parseTimestamp', () => {
  it('reads the format FTMO writes', () => {
    expect(parseTimestamp('2022-02-25 14:05:35')).toEqual({
      year: 2022,
      month: 2,
      day: 25,
      hour: 14,
      minute: 5,
      second: 35,
    });
  });

  it('reads MT5’s dotted year-first form and an ISO T separator', () => {
    expect(parseTimestamp('2025.03.10 09:35:12')?.month).toBe(3);
    expect(parseTimestamp('2025-03-10T09:35:12Z')?.hour).toBe(9);
    expect(parseTimestamp('2025/03/10 09:35')?.second).toBe(0);
    expect(parseTimestamp('2025-03-10')?.hour).toBe(0);
  });

  it('reads a day-first localised form, and recovers when the parts are the other way round', () => {
    expect(parseTimestamp('25.02.2022 14:05:35')?.day).toBe(25);
    // Month 25 cannot exist, so this one is month-first after all.
    expect(parseTimestamp('25.02.2022')).toEqual(
      expect.objectContaining({ day: 25, month: 2, year: 2022 }),
    );
    expect(parseTimestamp('02/25/2022')).toEqual(
      expect.objectContaining({ day: 25, month: 2, year: 2022 }),
    );
  });

  it('returns null for anything else, including impossible dates', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('yesterday')).toBeNull();
    expect(parseTimestamp('2022-13-01 00:00:00')).toBeNull();
    expect(parseTimestamp('2022-02-25 25:00:00')).toBeNull();
  });
});
