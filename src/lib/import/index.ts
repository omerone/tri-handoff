/**
 * File imports.
 *
 * The way into TRi for a trader who cannot, or would rather not, hand over a broker
 * password: a file they already have. Everything here is pure — text in, `TradeUpsert[]`
 * out — so it is testable without a database and reusable from a server action, a CLI
 * backfill or a migration without any of them growing their own copy of the rules.
 */

export {
  FtmoParseError,
  parseFtmoCsv,
  parseTimestamp,
  readFtmoCsv,
  type FtmoParseOptions,
  type FtmoParseReport,
} from './ftmo';

export {
  detectDecimalSeparator,
  detectDelimiter,
  parseNumber,
  splitDelimited,
  type DecimalSeparator,
} from './delimited';
