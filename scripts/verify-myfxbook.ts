/**
 * Ask Myfxbook whether it can be the free live feed, before anything is built on it.
 *
 * The idea under test: a trader connects their broker account to Myfxbook (free, investor
 * password, their infrastructure), and TRi reads it back through Myfxbook's public API instead
 * of paying MetaApi to run a terminal. Two things decide whether that works, and neither can
 * be settled by reading the documentation:
 *
 *  1. **How much history comes back.** The docs say `get-history` is "limited to the last 50
 *     transactions". If that is a hard cap, Myfxbook can keep a journal current but cannot
 *     populate one — the FTMO CSV import has to do the backfill.
 *  2. **Whether the numbers are the broker's.** Equity here has to match what the trader sees
 *     in MetaTrader. A journal that is confidently wrong is worse than one that is empty, and
 *     that is the exact failure this whole exercise started from.
 *
 *     MYFXBOOK_EMAIL=… MYFXBOOK_PASSWORD=… npm run myfxbook:verify
 *
 * Read-only: it logs in, reads, and logs out. Nothing is written anywhere. The password comes
 * from the environment rather than an argument, so it stays out of `ps` and the shell history.
 */

// This file imports nothing, and a TypeScript file with no import or export is a *script*: its
// top-level names land in the global scope and collide with every other such file in the
// project. `scripts/setup-cloudflare-waf.ts` also declares `main`, which is the collision.
export {};

const API = 'https://www.myfxbook.com/api';

type Envelope<T> = { error: boolean; message: string } & T;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. See the usage comment at the top of this file.`);
    process.exit(1);
  }
  return value;
}

async function call<T>(path: string, params: Record<string, string>): Promise<Envelope<T>> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${API}/${path}.json?${query}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${response.statusText}`);

  const body = (await response.json()) as Envelope<T>;
  // Myfxbook answers 200 with `error: true` rather than an HTTP status, so the envelope is the
  // only place a failure shows up.
  if (body.error) throw new Error(`${path}: ${body.message}`);
  return body;
}

type Account = {
  id: number;
  name?: string;
  accountId?: number;
  balance?: number;
  equity?: number;
  profit?: number;
  gain?: number;
  drawdown?: number;
  currency?: string;
  server?: { name?: string } | string;
  lastUpdateDate?: string;
};

type HistoryRow = {
  openTime?: string;
  closeTime?: string;
  symbol?: string;
  action?: string;
  lots?: number;
  profit?: number;
  commission?: number;
  swap?: number;
};

const money = (value: number | undefined, currency = 'USD') =>
  value === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

async function main() {
  const email = required('MYFXBOOK_EMAIL');
  const password = required('MYFXBOOK_PASSWORD');

  console.log('Signing in to Myfxbook…');
  const { session } = await call<{ session: string }>('login', { email, password });

  try {
    const { accounts } = await call<{ accounts: Account[] }>('get-my-accounts', { session });

    if (accounts.length === 0) {
      console.error('\nNo accounts on this Myfxbook profile yet.');
      console.error('Connect the broker account there first (Add account → Auto update → MT5),');
      console.error('wait for its first sync, then run this again.');
      process.exit(1);
    }

    console.log(`\n${accounts.length} account(s):\n`);
    for (const account of accounts) {
      const currency = account.currency ?? 'USD';
      const server = typeof account.server === 'string' ? account.server : account.server?.name;
      console.log(`  [${account.id}] ${account.name ?? '—'}  ${server ?? ''}`);
      console.log(
        `      balance ${money(account.balance, currency)}   equity ${money(account.equity, currency)}` +
          `   gain ${account.gain ?? '—'}%   drawdown ${account.drawdown ?? '—'}%`,
      );
      console.log(`      last update: ${account.lastUpdateDate ?? '—'}`);
    }

    const target = process.env.MYFXBOOK_ACCOUNT_ID
      ? accounts.find((a) => String(a.id) === process.env.MYFXBOOK_ACCOUNT_ID)
      : accounts[0];

    if (!target) {
      console.error(`\nNo account with id ${process.env.MYFXBOOK_ACCOUNT_ID}.`);
      process.exit(1);
    }

    const currency = target.currency ?? 'USD';
    console.log(`\nReading history for [${target.id}] ${target.name ?? ''}…`);

    const { history } = await call<{ history: HistoryRow[] }>('get-history', {
      session,
      id: String(target.id),
    });

    const closed = history.filter((row) => row.closeTime);
    const net = history.reduce(
      (sum, row) => sum + (row.profit ?? 0) + (row.commission ?? 0) + (row.swap ?? 0),
      0,
    );
    const times = closed
      .map((row) => Date.parse(row.closeTime!))
      .filter((value) => Number.isFinite(value));
    const span = times.length
      ? `${new Date(Math.min(...times)).toISOString().slice(0, 10)} → ${new Date(Math.max(...times)).toISOString().slice(0, 10)}`
      : '—';

    console.log(`  rows returned   ${history.length}   (${span})`);
    console.log(`  net from those  ${money(net, currency)}`);

    // The whole question. Anything at or just under 50 means we are seeing the cap rather than
    // the account, and the backfill has to come from the FTMO CSV export.
    if (history.length >= 50) {
      console.log(
        '\n  ⚠ 50 or more rows came back — this is the documented cap, not the whole account.',
      );
      console.log('    Myfxbook can keep the journal current; it cannot populate it.');
    } else {
      console.log(
        `\n  ✓ ${history.length} rows is under the documented 50-row cap, so this looks like the whole account.`,
      );
      console.log('    Worth confirming against the trade count in MetaTrader before trusting it.');
    }

    console.log('\nDaily series (what an equity curve would be drawn from)…');
    const today = new Date();
    const start = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const daily = await call<{ dataDaily: unknown[] }>('get-data-daily', {
      session,
      id: String(target.id),
      start: iso(start),
      end: iso(today),
    });
    console.log(`  ${daily.dataDaily?.length ?? 0} day(s) over the last year`);

    console.log('\nThe number to check by eye:');
    console.log(`  equity here      ${money(target.equity, currency)}`);
    console.log('  equity in MT5    (open the terminal and compare)');
    console.log('\nIf those disagree, stop — a feed that is confidently wrong is the problem,');
    console.log('not the solution.');
  } finally {
    // Sessions are IP-bound and live a month; leaving them open is untidy rather than unsafe,
    // but a script that logs in should log out.
    await call('logout', { session: (await Promise.resolve(session)) as string }).catch(() => {});
  }
}

main().catch((error) => {
  console.error('\nFailed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
