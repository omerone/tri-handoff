/**
 * Delimited-text primitives for file imports.
 *
 * Deliberately dependency-free and deliberately paranoid. A broker export is the one input
 * to TRi that nobody validates before it arrives: it is produced by somebody else's
 * localised web app, saved by a browser, and occasionally opened and re-saved in Excel on
 * the way here. Every one of those steps can change the delimiter, the decimal separator or
 * the line ending without changing anything a human would notice.
 *
 * The rule this file exists to enforce: a number that is read wrongly must not become a
 * plausible number. `1.234` read as one-point-two-three-four when it meant one thousand two
 * hundred and thirty four is exactly the failure that survives review, so separators are
 * decided once for the whole file from the evidence in it, not cell by cell.
 */

/** Delimiters worth trying, best first. FTMO's own export is semicolon-separated. */
const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'] as const;

export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * RFC 4180-ish splitter: quoted fields, `""` as an escaped quote, newlines inside quotes,
 * and any of CRLF / LF / CR as a row terminator.
 *
 * Rows are returned exactly as they appear — no trimming, no blank-row filtering — because
 * the caller needs the original row numbers to point at a bad row in an error message.
 */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // A leading BOM is what Excel writes and what would otherwise turn the first header cell
  // into something no alias table will ever match.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      field += ch;
    }
  }

  // A file that does not end in a newline still has a final row; one that does must not gain
  // a phantom empty one.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

/**
 * Picks the delimiter that carves the header line into the most columns.
 *
 * Counting raw characters would be fooled by a symbol or a quoted label containing the other
 * candidate; actually splitting is barely more expensive and cannot be.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ';';
  let bestColumns = 0;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const rows = splitDelimited(text, candidate);
    const header = rows.find((row) => !isBlankRow(row));
    const columns = header?.length ?? 0;
    if (columns > bestColumns) {
      best = candidate;
      bestColumns = columns;
    }
  }

  return best;
}

/* ------------------------------------------------------------------------------------- */

export type DecimalSeparator = '.' | ',';

/**
 * Every flavour of space a spreadsheet uses as a thousands separator: ordinary, no-break
 * (U+00A0 — what Excel writes in a French locale), narrow no-break, figure space.
 */
const SPACES = /[\s\u00a0\u202f\u2007\ufeff]/g;

const stripSpaces = (raw: string): string => raw.replace(SPACES, '');

/**
 * Decides the file's decimal separator from every numeric-looking cell in it.
 *
 * Per-cell detection is impossible: `1,234` is one thousand two hundred and thirty four in
 * an English export and one-point-two-three-four in a French one, and nothing in the cell
 * says which. But a *file* is internally consistent, and almost every real export contains
 * at least one cell that settles it — a price with five decimals, a profit with two, or a
 * value carrying both separators at once.
 *
 * Evidence, strongest first:
 *   - both separators present → the rightmost is the decimal one, the other is thousands;
 *   - one separator appearing more than once → it must be the thousands one;
 *   - one separator with other than three digits behind it → it must be the decimal one.
 *
 * A cell like `1,234` on its own is evidence of nothing and is ignored. With no evidence at
 * all the answer is `.`, which is what FTMO's own export uses.
 */
export function detectDecimalSeparator(cells: Iterable<string>): DecimalSeparator {
  let dot = 0;
  let comma = 0;

  for (const cell of cells) {
    const value = stripSpaces(cell).replace(/^[+-]/, '');
    if (value === '' || !/^[\d.,]+$/.test(value)) continue;

    const dots = (value.match(/\./g) ?? []).length;
    const commas = (value.match(/,/g) ?? []).length;

    if (dots > 0 && commas > 0) {
      if (value.lastIndexOf('.') > value.lastIndexOf(',')) dot += 4;
      else comma += 4;
      continue;
    }

    if (dots > 1) {
      comma += 2;
      continue;
    }
    if (commas > 1) {
      dot += 2;
      continue;
    }

    if (dots === 1 && value.length - value.indexOf('.') - 1 !== 3) dot += 1;
    if (commas === 1 && value.length - value.indexOf(',') - 1 !== 3) comma += 1;
  }

  if (comma > dot) return ',';
  return '.';
}

/**
 * Parses a number written with a known decimal separator, or null when the cell is empty or
 * is not a number at all.
 *
 * Null rather than zero, and never NaN: a missing commission and a commission of zero are
 * the same money, but a *malformed* commission must be able to reach the caller as a
 * failure rather than quietly becoming 0 and being summed into a performance figure.
 */
export function parseNumber(raw: string, decimal: DecimalSeparator): number | null {
  const thousands = decimal === '.' ? ',' : '.';
  let value = stripSpaces(raw);
  if (value === '') return null;

  value = value.split(thousands).join('');
  if (decimal === ',') value = value.replace(',', '.');

  // Reject anything that is not a plain signed decimal — currency symbols, `1.2.3`, `N/A`.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value)) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ------------------------------------------------------------------------------------- */

/**
 * FNV-1a, twice, with different offset bases — sixteen hex characters of deterministic
 * digest with no dependency and no Node built-in.
 *
 * Used only to disambiguate rows that share a broker ticket, so a collision would merge two
 * trades rather than corrupt one; 64 bits is far more than that risk needs.
 */
export function stableHash(parts: readonly string[]): string {
  const input = parts.join('\0');
  const fnv = (offset: number): string => {
    let hash = offset >>> 0;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x0f7a2b13);
}
