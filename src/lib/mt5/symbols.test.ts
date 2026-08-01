import { describe, expect, it } from 'vitest';
import { classifySymbol, findSymbolSpec, KNOWN_SYMBOLS, normalizeSymbol } from './symbols';

/**
 * Classification feeds the "by asset class" dimension; the spec lookup feeds the risk
 * calculation. The second is the one that has to fail loudly — a wrong contract size gives a
 * wrong RR that looks entirely reasonable.
 */

describe('normalizeSymbol', () => {
  it('strips the account-type suffixes brokers append', () => {
    expect(normalizeSymbol('EURUSD.raw')).toBe('EURUSD');
    expect(normalizeSymbol('XAUUSD-ECN')).toBe('XAUUSD');
    expect(normalizeSymbol('EURUSD_i')).toBe('EURUSD');
  });

  it('uppercases and trims', () => {
    expect(normalizeSymbol('  eurusd ')).toBe('EURUSD');
  });

  it('leaves a plain symbol alone', () => {
    expect(normalizeSymbol('NAS100')).toBe('NAS100');
    expect(normalizeSymbol('AAPL')).toBe('AAPL');
  });
});

describe('findSymbolSpec', () => {
  it('finds a symbol through its broker suffix', () => {
    expect(findSymbolSpec('EURUSD.raw')?.contractSize).toBe(100_000);
  });

  it('returns null for an unknown symbol rather than a default', () => {
    // The whole point: no spec means no RR, not a guessed contract size.
    expect(findSymbolSpec('MADEUPPAIR')).toBeNull();
  });

  it('gives each class the contract size the market actually uses', () => {
    expect(findSymbolSpec('EURUSD')?.contractSize).toBe(100_000);
    expect(findSymbolSpec('XAUUSD')?.contractSize).toBe(100);
    expect(findSymbolSpec('XAGUSD')?.contractSize).toBe(5_000);
    expect(findSymbolSpec('BTCUSD')?.contractSize).toBe(1);
    expect(findSymbolSpec('US500')?.contractSize).toBe(1);
    expect(findSymbolSpec('AAPL')?.contractSize).toBe(1);
  });

  it('records the quote currency, including the ones that are not dollars', () => {
    expect(findSymbolSpec('USDJPY')?.quoteCurrency).toBe('JPY');
    expect(findSymbolSpec('GER40')?.quoteCurrency).toBe('EUR');
    expect(findSymbolSpec('EURUSD')?.quoteCurrency).toBe('USD');
  });

  it('has a sane spec for every symbol in the table', () => {
    for (const symbol of KNOWN_SYMBOLS) {
      const spec = findSymbolSpec(symbol)!;
      expect(spec.contractSize).toBeGreaterThan(0);
      expect(spec.digits).toBeGreaterThanOrEqual(0);
      expect(spec.quoteCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe('classifySymbol', () => {
  it('classifies the symbols in the table', () => {
    expect(classifySymbol('EURUSD')).toBe('forex');
    expect(classifySymbol('BTCUSD')).toBe('crypto');
    expect(classifySymbol('NAS100')).toBe('indices');
    expect(classifySymbol('TSLA')).toBe('stocks');
  });

  it('files metals and energy under commodities, which SPEC §3.5 asks for separately', () => {
    expect(classifySymbol('XAUUSD')).toBe('commodities');
    expect(classifySymbol('XAGUSD')).toBe('commodities');
    expect(classifySymbol('USOIL')).toBe('commodities');
  });

  it('recognises a six-letter currency pair it has never seen', () => {
    expect(classifySymbol('EURGBP')).toBe('forex');
    expect(classifySymbol('NZDCAD')).toBe('forex');
  });

  it('recognises unfamiliar crypto and indices by prefix', () => {
    expect(classifySymbol('XRPUSD')).toBe('crypto');
    expect(classifySymbol('DOGEUSD')).toBe('crypto');
    expect(classifySymbol('UK100')).toBe('indices');
    expect(classifySymbol('JP225')).toBe('indices');
  });

  it('treats a short alphabetic ticker as a share', () => {
    expect(classifySymbol('AMZN')).toBe('stocks');
    expect(classifySymbol('KO')).toBe('stocks');
  });

  it('says "other" rather than guessing', () => {
    expect(classifySymbol('WEIRDTHING123')).toBe('other');
    expect(classifySymbol('')).toBe('other');
  });

  it('sees through a broker suffix', () => {
    expect(classifySymbol('BTCUSD.raw')).toBe('crypto');
    expect(classifySymbol('XAUUSD-ECN')).toBe('commodities');
  });
});
