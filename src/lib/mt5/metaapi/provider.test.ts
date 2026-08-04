import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaApiProvider } from './provider';

/**
 * How a refused connection is read.
 *
 * This provider has never run against a live MetaApi account — see the note at the top of
 * `provider.ts` — so the failure paths are the part most worth pinning down, and the server
 * name is the field most likely to be wrong. A broker names its servers its own way
 * (`FTMO-Server4`, `ICMarketsSC-MT5`), the trader reads the name off MetaTrader rather than
 * off anything this app knows, and MetaApi answers an unrecognised one with the names it does
 * hold. Turning that into "did you mean…" is the difference between a fixable mistake and a
 * dead end, and it is all parsing — which means it can be tested here.
 *
 * The response shapes are MetaApi's documented ones; the field carrying the near matches has
 * moved between versions, so more than one is accepted.
 */

const respond = (status: number, body: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Bad Request',
      json: async () => body,
    })) as unknown as typeof fetch,
  );
};

const credentials = {
  login: '541171171',
  server: 'FTMO-Server-4',
  investorPassword: 'investor',
};

afterEach(() => vi.unstubAllGlobals());

describe('an unrecognised server name', () => {
  it('is told apart from an unreachable broker, and carries the near matches', async () => {
    respond(400, {
      id: 'E_SRV_NOT_FOUND',
      message: '.dat file for server FTMO-Server-4 not found, please check the server name',
      metadata: { recommendedServers: ['FTMO-Server4', 'FTMO-Server3'] },
    });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual(['FTMO-Server4', 'FTMO-Server3']);
  });

  it('is recognised from the sentence when no machine-readable code is sent', async () => {
    // MetaApi has not always set `id`; the wording has been stable for longer than the code.
    respond(400, {
      message: '.dat file for server Nope-1 not found, please check the server name',
      similarServerNames: ['ICMarketsSC-MT5'],
    });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual(['ICMarketsSC-MT5']);
  });

  it('still reports the right reason when the provider offers no alternatives', async () => {
    respond(400, { id: 'E_SRV_NOT_FOUND', message: 'server not found' });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual([]);
  });
});

describe('the other refusals', () => {
  it('reads a 401 as credentials rather than as a server problem', async () => {
    respond(401, { message: 'Invalid token' });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-credentials');
  });

  it('falls back to unreachable for anything else, keeping the detail', async () => {
    respond(503, { message: 'Service temporarily unavailable' });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unreachable');
    expect(result.detail).toContain('503');
  });

  it('never puts the investor password in the error it reports', async () => {
    // The failing *request* carries it; the message must come from the response alone.
    respond(400, { message: 'something went wrong' });

    const result = await new MetaApiProvider('token').verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain(credentials.investorPassword);
  });
});
