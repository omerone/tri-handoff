import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountName, MetaApiProvider } from './provider';

/**
 * The provisioning handshake, and how a refused connection is read.
 *
 * This provider has never run against a live MetaApi account — see the note at the top of
 * `provider.ts` — so everything here is written against MetaApi's documented shapes rather
 * than against a capture. Two families of test:
 *
 *  - the handshake: what is actually sent when an account is created, that the wait for the
 *    account to come up ends (both ways: ready, and out of time), and that a stored account id
 *    short-circuits the whole thing. This is the part a first live connection trips over.
 *  - the failure parsing: the server name is the field most likely to be wrong and the least
 *    guessable — a broker names its servers its own way (`FTMO-Server4`, `ICMarketsSC-MT5`),
 *    the trader reads the name off MetaTrader rather than off anything this app knows, and
 *    MetaApi answers an unrecognised one with the names it does hold, keyed by broker.
 */

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** Routes every fetch through one handler, and keeps the calls for inspection. */
function mockFetch(handler: (call: Call, index: number) => Reply | undefined) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        url: String(input),
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      };
      calls.push(call);

      const reply = handler(call, calls.length - 1) ?? {};
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: 'Response',
        headers: new Headers(reply.headers ?? {}),
        json: async () => reply.body ?? null,
      };
    }) as unknown as typeof fetch,
  );

  return calls;
}

/** The one-line version of the above, for the tests that only care about the first answer. */
const respond = (status: number, body: unknown) => mockFetch(() => ({ status, body }));

const credentials = {
  login: '541171171',
  server: 'FTMO-Server-4',
  investorPassword: 'investor',
  accountKey: 'user-alice',
};

/** The same MT5 account number, reached from a different TRi user's session. */
const otherTenant = { ...credentials, accountKey: 'user-mallory', investorPassword: 'guessed' };

const READY = { _id: 'acc-1', state: 'DEPLOYED', connectionStatus: 'CONNECTED' };
const ACCOUNT_INFO = { balance: 10_000, equity: 10_050, currency: 'USD', name: 'FTMO Challenge' };

/** A provider that does not spend real minutes waiting. */
const provider = (region = 'new-york') =>
  new MetaApiProvider('token', region, { readyTimeoutMs: 400, pollIntervalMs: 5 });

afterEach(() => vi.unstubAllGlobals());

describe('creating the account', () => {
  it('sends the payload MetaApi documents, with a transaction id', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1', state: 'DEPLOYED' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      if (call.url.includes('?query=')) return { body: [] };
      return { body: READY };
    });

    const result = await provider('london').verify(credentials);
    expect(result.ok).toBe(true);

    const create = calls.find((call) => call.method === 'POST');
    expect(create?.body).toEqual({
      login: '541171171',
      password: 'investor',
      // Carries the owner, so another user's lookup cannot match it. See `findAccount`.
      name: 'tri-useralice-541171171',
      server: 'FTMO-Server-4',
      platform: 'mt5',
      type: 'cloud-g2',
      region: 'london',
      reliability: 'high',
      magic: 0,
      manualTrades: true,
      // The broker company name, not the server name: this is what MetaApi searches by.
      keywords: ['FTMO Global Markets Ltd'],
    });
    // Documented as required, and documented as "32-character".
    expect(create?.headers['transaction-id']).toMatch(/^[0-9a-f]{32}$/);
    expect(create?.headers['auth-token']).toBe('token');
  });

  it('creates the account in the same region it then reads it from', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      if (call.url.includes('?query=')) return { body: [] };
      return { body: READY };
    });

    await provider('singapore').fetchAccountState(credentials);

    const create = calls.find((call) => call.method === 'POST');
    const read = calls.find((call) => call.url.includes('account-information'));
    expect(create?.body?.region).toBe('singapore');
    // A client call to a host that does not hold the account is a 404, so these must agree.
    expect(read?.url).toContain('https://mt-client-api-v1.singapore.agiliumtrade.ai');
  });

  it('retries a 202 with the same transaction id and waits the time it is told to', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST' && calls.filter((c) => c.method === 'POST').length === 1) {
        return {
          status: 202,
          headers: { 'retry-after': '0' },
          body: { message: 'Automatic broker settings detection is in progress' },
        };
      }
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      if (call.url.includes('?query=')) return { body: [] };
      return { body: READY };
    });

    const state = await provider().fetchAccountState(credentials);

    const creates = calls.filter((call) => call.method === 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.headers['transaction-id']).toBe(creates[0]?.headers['transaction-id']);
    // 202 is not success: the old code read `id` off that body and asked for
    // `/accounts/undefined/account-information`.
    expect(state.providerAccountId).toBe('acc-1');
  });

  it('gives up on a broker detection that never finishes, and says so', async () => {
    mockFetch((call) => {
      if (call.method === 'POST') return { status: 202, headers: { 'retry-after': '60' } };
      return { body: [] };
    });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unreachable');
    expect(result.detail).toContain('still detecting the broker settings');
  });
});

describe('waiting for the account to come up', () => {
  it('polls until it is deployed and connected, then reads it', async () => {
    const states = [
      { _id: 'acc-1', state: 'DEPLOYING', connectionStatus: 'DISCONNECTED' },
      { _id: 'acc-1', state: 'DEPLOYED', connectionStatus: 'DISCONNECTED' },
      READY,
    ];
    let poll = 0;

    const calls = mockFetch((call) => {
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      if (call.url.includes('?query=')) return { body: [] };
      return { body: states[Math.min(poll++, states.length - 1)] };
    });

    const state = await provider().fetchAccountState(credentials);

    expect(state.balance).toBe(10_000);
    expect(poll).toBe(3);
    // DEPLOYING is on its way up; deploying it again would be noise.
    expect(calls.some((call) => call.url.endsWith('/deploy'))).toBe(false);
  });

  it('deploys an account that is registered but stopped', async () => {
    let poll = 0;
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        return { body: [{ _id: 'acc-1', name: accountName(credentials), login: '541171171', server: 'FTMO-Server-4' }] };
      }
      if (call.url.endsWith('/deploy')) return { status: 204 };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      poll += 1;
      return {
        body: poll === 1 ? { _id: 'acc-1', state: 'UNDEPLOYED', connectionStatus: 'DISCONNECTED' } : READY,
      };
    });

    await provider().fetchAccountState(credentials);

    const deploy = calls.find((call) => call.url.endsWith('/deploy'));
    expect(deploy?.method).toBe('POST');
    // The account already existed, so nothing was created.
    expect(calls.some((call) => call.url.endsWith('/users/current/accounts'))).toBe(false);
  });

  it('stops waiting on an account that never comes up, and names the state it stuck in', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('?query=')) return { body: [] };
      return { body: { _id: 'acc-1', state: 'DEPLOYING', connectionStatus: 'DISCONNECTED' } };
    });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unreachable');
    expect(result.detail).toContain('was not ready within');
    expect(result.detail).toContain('state=DEPLOYING');
    // Bounded: it polled a few times and then stopped, rather than holding the sync open.
    expect(calls.length).toBeLessThan(200);
    // And it never got as far as reading the account.
    expect(calls.some((call) => call.url.includes('account-information'))).toBe(false);
  });
});

describe('finding an account that already exists', () => {
  it('skips every lookup when the stored provider account id is passed in', async () => {
    const calls = mockFetch(() => ({ body: ACCOUNT_INFO }));

    const state = await provider().fetchAccountState({
      ...credentials,
      providerAccountId: 'acc-stored',
    });

    expect(state.balance).toBe(10_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/users/current/accounts/acc-stored/account-information');
  });

  it('looks the account up once per sync, not once per call', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        return { body: [{ _id: 'acc-1', name: accountName(credentials), login: '541171171', server: 'FTMO-Server-4' }] };
      }
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      if (call.url.includes('history-deals')) return { body: [] };
      return { body: READY };
    });

    const subject = provider();
    await subject.fetchAccountState(credentials);
    await subject.fetchDeals(credentials);

    expect(calls.filter((call) => call.url.includes('?query=')).length).toBe(1);
  });

  it('does not adopt the same account number at a different broker', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        // Same login, another client's broker. Matching on the number alone would hand this
        // client someone else's account.
        return { body: [{ _id: 'someone-else', login: '541171171', server: 'ICMarketsSC-MT5' }] };
      }
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      return { body: READY };
    });

    const state = await provider().fetchAccountState(credentials);

    expect(state.providerAccountId).toBe('acc-1');
    expect(calls.some((call) => call.url.includes('someone-else'))).toBe(false);
    // The listing is narrowed server-side rather than trusting the default page size.
    expect(calls[0]?.url).toContain('?query=541171171');
  });

  /**
   * The one that is a breach rather than a bug.
   *
   * Every client is registered under one shared MetaApi subscription, and this lookup runs
   * before the broker has judged anything the caller typed. Matching on login and server alone
   * meant the second person to enter someone else's account number was handed their account id
   * with any password at all — balance on screen, whole history into the wrong journal, no
   * secret required, because an MT5 login is eight digits and the server name is printed on
   * the broker's login screen.
   */
  it("will not hand one user the account another user registered", async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        // Alice's registration: same login, same broker, and it is not Mallory's to find.
        return {
          body: [
            {
              _id: 'alice-account',
              name: accountName(credentials),
              login: '541171171',
              server: 'FTMO-Server-4',
            },
          ],
        };
      }
      if (call.method === 'POST') return { status: 201, body: { id: 'mallory-account' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      return { body: READY };
    });

    const state = await provider().fetchAccountState(otherTenant);

    // Mallory gets a registration of her own, which the broker then has to accept or refuse.
    expect(state.providerAccountId).toBe('mallory-account');
    expect(calls.some((call) => call.url.includes('alice-account'))).toBe(false);

    // And the password she guessed is what MetaApi is asked to prove, rather than skipped.
    const created = calls.find((call) => call.method === 'POST' && call.body !== null);
    expect(created?.body?.password).toBe('guessed');
    expect(created?.body?.name).toBe(accountName(otherTenant));
    expect(created?.body?.name).not.toBe(accountName(credentials));
  });

  it('finds its own account again on the next sync, rather than registering a second one', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        return {
          body: [
            {
              _id: 'alice-account',
              name: accountName(credentials),
              login: '541171171',
              server: 'FTMO-Server-4',
            },
          ],
        };
      }
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      return { body: READY };
    });

    const state = await provider().fetchAccountState(credentials);

    expect(state.providerAccountId).toBe('alice-account');
    // Nothing was created: a second registration would be a second billed account.
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/accounts'))).toBe(false);
  });
});

describe('reading the history', () => {
  it('pages through the whole history instead of taking the first 1000 deals', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${from + i}`,
        type: 'DEAL_TYPE_BALANCE',
        time: '2024-01-01T00:00:00.000Z',
        profit: 1,
      }));

    const calls = mockFetch((call) => {
      if (call.url.includes('history-deals')) {
        const offset = Number(new URL(call.url).searchParams.get('offset'));
        return { body: offset === 0 ? page(0, 1000) : page(1000, 7) };
      }
      return { body: ACCOUNT_INFO };
    });

    const deals = await provider().fetchDeals({ ...credentials, providerAccountId: 'acc-1' });

    expect(deals).toHaveLength(1007);
    const pages = calls.filter((call) => call.url.includes('history-deals'));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.url).toContain('offset=0&limit=1000');
    expect(pages[1]?.url).toContain('offset=1000&limit=1000');
  });
});

describe('an unrecognised server name', () => {
  it('is told apart from an unreachable broker, and carries the names the broker does use', async () => {
    respond(400, {
      id: 3,
      error: 'ValidationError',
      message: '.dat file for server FTMO-Server-4 not found, please check the server name',
      details: {
        code: 'E_SRV_NOT_FOUND',
        serversByBrokers: { 'FTMO Global Markets Ltd': ['FTMO-Server4', 'FTMO-Server3'] },
      },
    });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual(['FTMO-Server4', 'FTMO-Server3']);
    // The documented escalation, for whoever reads the log. Not shown on screen.
    expect(result.detail).toContain('servers.dat');
  });

  it('is recognised from the sentence when no machine-readable code is sent', async () => {
    respond(400, {
      message: '.dat file for server Nope-1 not found, please check the server name',
    });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual([]);
  });

  it('still reports the right reason when the provider offers no alternatives', async () => {
    respond(400, { id: 3, message: 'server not found', details: { code: 'E_SRV_NOT_FOUND' } });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-server');
    expect(result.suggestions).toEqual([]);
  });
});

describe('the other refusals', () => {
  it('reads a 401 as credentials rather than as a server problem', async () => {
    respond(401, { message: 'Invalid token' });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-credentials');
  });

  it('reads the broker refusing the login as credentials, not as "try again later"', async () => {
    // `details` is a bare string in this family of errors, and retrying it is billable.
    respond(400, { id: 3, error: 'ValidationError', message: 'Authentication failed', details: 'E_AUTH' });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-credentials');
  });

  it('falls back to unreachable for anything else, keeping the detail', async () => {
    respond(503, { message: 'Service temporarily unavailable' });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unreachable');
    expect(result.detail).toContain('503');
  });

  it('never puts the investor password in the error it reports', async () => {
    // The failing *request* carries it; the message must come from the response alone.
    respond(400, { message: 'something went wrong' });

    const result = await provider().verify(credentials);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result)).not.toContain(credentials.investorPassword);
  });
});

describe('handing the terminal back', () => {
  /**
   * The bill this exists to stop.
   *
   * MetaApi charges $0.0126 an hour for a running account and $0.00105 for a stopped one —
   * $9.20 a month against $0.77 — and TRi reads a broker on a button press and then does
   * nothing for days. Leaving the terminal up is renting a machine to sit idle.
   */
  it('stops the account when the sync is done', async () => {
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) {
        return {
          body: [
            {
              _id: 'acc-1',
              name: accountName(credentials),
              login: '541171171',
              server: 'FTMO-Server-4',
            },
          ],
        };
      }
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      return { body: READY };
    });

    const subject = provider();
    await subject.fetchAccountState(credentials);
    await subject.release!(credentials);

    const undeploy = calls.find((call) => call.url.endsWith('/undeploy'));
    expect(undeploy?.method).toBe('POST');
    expect(undeploy?.url).toContain('acc-1');
  });

  it('leaves it running when the deployment is meant to stay up', async () => {
    // Above roughly four syncs a day the per-deployment fee overtakes the idle hours, so a
    // desk that refreshes all day is better off paying for the terminal.
    const calls = mockFetch((call) => {
      if (call.url.includes('?query=')) return { body: [] };
      if (call.method === 'POST') return { status: 201, body: { id: 'acc-1' } };
      if (call.url.includes('account-information')) return { body: ACCOUNT_INFO };
      return { body: READY };
    });

    const subject = new MetaApiProvider('token', 'new-york', {
      readyTimeoutMs: 400,
      pollIntervalMs: 5,
      keepDeployed: true,
    });
    await subject.fetchAccountState(credentials);
    await subject.release!(credentials);

    expect(calls.some((call) => call.url.endsWith('/undeploy'))).toBe(false);
  });

  it('does not turn a failed release into a failed sync', async () => {
    // A release is an economy. An economy that fails is not a sync that failed, and throwing
    // here would put a billing error in front of a trader whose trades imported fine.
    mockFetch((call) => {
      if (call.url.endsWith('/undeploy')) return { status: 500, body: { message: 'nope' } };
      if (call.url.includes('?query=')) {
        return {
          body: [
            {
              _id: 'acc-1',
              name: accountName(credentials),
              login: '541171171',
              server: 'FTMO-Server-4',
            },
          ],
        };
      }
      return { body: READY };
    });

    await expect(provider().release!(credentials)).resolves.toBeUndefined();
  });

  it('spends one request when the account id is already known', async () => {
    // The stored provider account id is the whole point of the column: a release should be a
    // single POST, not a listing followed by a readiness poll.
    const calls = mockFetch(() => ({ status: 204 }));

    await provider().release!({ ...credentials, providerAccountId: 'acc-stored' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('acc-stored/undeploy');
  });
});
