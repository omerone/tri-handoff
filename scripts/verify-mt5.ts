/**
 * Prove a live MT5 connection before wiring it into the app.
 *
 * The MetaApi provider has never run against a real account (see the note at the top of
 * `src/lib/mt5/metaapi/provider.ts`). Turning it on in production is therefore a guess, and a
 * wrong guess is a failed sync in front of a client. This script makes the same calls the
 * sync makes — account state, then history — against the same provider class, and prints what
 * came back. Nothing is written: no database, no `mt5_accounts`, no trades.
 *
 *     METAAPI_TOKEN=... MT5_LOGIN=... MT5_SERVER=... MT5_PASSWORD=... npm run mt5:verify
 *
 * Read the password from the environment rather than a flag: an argument is visible in `ps`
 * to every user on the machine, and lands in the shell history file.
 */
import { MetaApiProvider } from '../src/lib/mt5/metaapi/provider';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}. See the usage comment at the top of this file.`);
    process.exit(1);
  }
  return value;
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);

async function main() {
  const token = required('METAAPI_TOKEN');
  const credentials = {
    login: required('MT5_LOGIN'),
    server: required('MT5_SERVER'),
    investorPassword: required('MT5_PASSWORD'),
  };

  const provider = new MetaApiProvider(token, process.env.METAAPI_REGION ?? 'new-york');

  console.log(`Connecting to ${credentials.login} on ${credentials.server}…`);
  console.log('(A first connection provisions the account with MetaApi and can take a minute.)\n');

  const verdict = await provider.verify(credentials);

  if (!verdict.ok) {
    console.error(`FAILED: ${verdict.reason}`);
    if ('detail' in verdict && verdict.detail) console.error(verdict.detail);
    // The wizard shows these to the user; seeing them here is how we learn the server name
    // FTMO publishes is not the one printed in the terminal.
    if ('suggestions' in verdict && verdict.suggestions?.length) {
      console.error(`\nServer names MetaApi does know: ${verdict.suggestions.join(', ')}`);
    }
    process.exit(1);
  }

  const { account } = verdict;
  console.log('ACCOUNT');
  console.log(`  name      ${account.name ?? '—'}`);
  console.log(`  currency  ${account.currency}`);
  console.log(`  balance   ${money(account.balance, account.currency)}`);
  console.log(`  equity    ${money(account.equity, account.currency)}`);

  console.log('\nHistory (full backfill, as the first sync would do)…');
  const deals = await provider.fetchDeals(credentials);

  const trades = deals.filter((deal) => deal.kind === 'trade');
  const cash = deals.filter((deal) => deal.kind === 'balance' || deal.kind === 'credit');
  const net = trades.reduce((sum, d) => sum + d.profit + d.commission + d.swap, 0);
  const closes = trades.map((d) => d.closeAt).filter((at): at is Date => at !== null);
  const span = (dates: Date[]) =>
    dates.length
      ? `${new Date(Math.min(...dates.map(Number))).toISOString().slice(0, 10)} → ${new Date(Math.max(...dates.map(Number))).toISOString().slice(0, 10)}`
      : '—';

  console.log(`  closed positions  ${trades.length}   (${span(closes)})`);
  console.log(`  deposits/credits  ${cash.length}`);
  console.log(`  net from trades   ${money(net, account.currency)}`);

  // The one number the client can check against their own terminal. If deposits plus trading
  // does not land on the reported balance, the deal aggregation is wrong — which is exactly
  // the part the provider file flags as most likely to need adjusting.
  const deposits = cash.reduce((sum, d) => sum + d.profit + d.commission + d.swap, 0);
  const reconstructed = deposits + net;
  const drift = account.balance - reconstructed;
  console.log(`\n  deposits + trades = ${money(reconstructed, account.currency)}`);
  console.log(`  reported balance  = ${money(account.balance, account.currency)}`);
  console.log(
    Math.abs(drift) < 0.01
      ? '  ✓ reconciles — the aggregation agrees with the broker.'
      : `  ✗ off by ${money(drift, account.currency)} — open positions, or the aggregation needs work.`,
  );

  if (trades.length > 0) {
    console.log('\nFive most recent closed positions:');
    for (const deal of trades.slice(-5)) {
      const when = deal.closeAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '—';
      const pnl = money(deal.profit + deal.commission + deal.swap, account.currency);
      console.log(`  ${when}  ${deal.symbol.padEnd(8)} ${deal.direction.padEnd(5)} ${deal.volume.toString().padStart(6)}  ${pnl}`);
    }
  }
}

main().catch((error) => {
  console.error('\nUnexpected failure:', error instanceof Error ? error.message : error);
  process.exit(1);
});
