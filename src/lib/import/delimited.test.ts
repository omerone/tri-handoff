import { describe, expect, it } from 'vitest';
import {
  detectDecimalSeparator,
  detectDelimiter,
  parseNumber,
  splitDelimited,
  stableHash,
} from './delimited';

describe('splitDelimited', () => {
  it('splits a plain semicolon file', () => {
    expect(splitDelimited('a;b;c\n1;2;3', ';')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps quoted fields whole, including the delimiter and newlines inside them', () => {
    const rows = splitDelimited('a;"b;still b";"two\nlines"\n', ';');
    expect(rows).toEqual([['a', 'b;still b', 'two\nlines']]);
  });

  it('unescapes doubled quotes', () => {
    expect(splitDelimited('"say ""hi""";x', ';')).toEqual([['say "hi"', 'x']]);
  });

  it('accepts CRLF, LF and CR line endings alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      expect(splitDelimited(`a;b${eol}c;d`, ';')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    }
  });

  it('does not invent a trailing row for a file that ends in a newline', () => {
    expect(splitDelimited('a;b\n', ';')).toHaveLength(1);
  });

  it('strips a byte-order mark, which would otherwise poison the first header cell', () => {
    expect(splitDelimited('﻿Ticket;Open', ';')[0]?.[0]).toBe('Ticket');
  });
});

describe('detectDelimiter', () => {
  it('picks the semicolon FTMO actually uses, even though prices contain dots', () => {
    expect(detectDelimiter('Ticket;Open;Type\n1;"2022-01-01 00:00:00";buy')).toBe(';');
  });

  it('picks the comma when a spreadsheet has re-saved the file', () => {
    expect(detectDelimiter('Ticket,Open,Type,Volume\n1,x,buy,0.1')).toBe(',');
  });

  it('is not fooled by a delimiter that only appears inside a quoted cell', () => {
    expect(detectDelimiter('"a;b";"c;d";e\n1;2;3')).toBe(';');
  });
});

describe('detectDecimalSeparator', () => {
  it('reads an English export as dot-decimal', () => {
    expect(detectDecimalSeparator(['38878.28', '0.01', '1.13236', '-15.55'])).toBe('.');
  });

  it('reads a French export as comma-decimal', () => {
    expect(detectDecimalSeparator(['38878,28', '0,01', '1,13236', '-15,55'])).toBe(',');
  });

  it('lets a cell carrying both separators settle it outright', () => {
    expect(detectDecimalSeparator(['1.234,56'])).toBe(',');
    expect(detectDecimalSeparator(['1,234.56'])).toBe('.');
  });

  it('treats a lone 1,234 as evidence of nothing rather than guessing', () => {
    // Genuinely ambiguous — one thousand two hundred and thirty four, or 1.234? The answer
    // is "we do not know", and the fallback is the separator FTMO's own export uses.
    expect(detectDecimalSeparator(['1,234'])).toBe('.');
  });

  it('uses a repeated separator as proof it is the thousands one', () => {
    expect(detectDecimalSeparator(['1.234.567'])).toBe(',');
  });
});

describe('parseNumber', () => {
  it('reads plain dot-decimal numbers', () => {
    expect(parseNumber('38878.28', '.')).toBe(38878.28);
    expect(parseNumber('-15.55', '.')).toBe(-15.55);
    expect(parseNumber('0', '.')).toBe(0);
  });

  it('strips thousands separators of either flavour', () => {
    expect(parseNumber('1,234.56', '.')).toBe(1234.56);
    expect(parseNumber('1.234,56', ',')).toBe(1234.56);
  });

  it('strips ordinary and no-break spaces used as thousands separators', () => {
    expect(parseNumber('4 326,95', ',')).toBe(4326.95);
    // The no-break space Excel actually writes in a French locale, and its narrow twin.
    expect(parseNumber('4\u00a0326,95', ',')).toBe(4326.95);
    expect(parseNumber('4\u202f326,95', ',')).toBe(4326.95);
    expect(parseNumber('- 5.00', '.')).toBe(-5);
  });

  it('returns null rather than NaN for something that is not a number', () => {
    expect(parseNumber('', '.')).toBeNull();
    expect(parseNumber('N/A', '.')).toBeNull();
    expect(parseNumber('1.2.3', '.')).toBeNull();
    expect(parseNumber('$5.00', '.')).toBeNull();
  });
});

describe('stableHash', () => {
  it('is deterministic', () => {
    expect(stableHash(['a', 'b'])).toBe(stableHash(['a', 'b']));
  });

  it('separates inputs that differ', () => {
    expect(stableHash(['a', 'b'])).not.toBe(stableHash(['a', 'c']));
  });

  it('is sixteen hex characters', () => {
    expect(stableHash(['x'])).toMatch(/^[0-9a-f]{16}$/);
  });
});
