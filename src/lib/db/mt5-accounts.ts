import 'server-only';
import { cache } from 'react';
import type { Mt5Status, TradeStyle } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import { MAX_MT5_ACCOUNTS } from '@/lib/mt5/types';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * The trader's MT5 accounts.
 *
 * SPEC §3.3 said one per user and the schema enforced it. A client running a day-trading
 * account and a swing account against one journal made that wrong: merged into one book every
 * metric is the average of two strategies and describes neither. Each function here is scoped
 * to an account id, because the alternative — "the user's account" — is the assumption that
 * silently overwrote one connection with the other.
 *
 * The stored investor password is the most sensitive thing in the database, so it leaves
 * this module by exactly one door: `readCredentialCiphertext`, which the sync uses and
 * nothing else. Every other read returns `Mt5AccountView`, which has no field it could hide
 * in — a page cannot accidentally serialise it into the HTML, because it never has it.
 */

/** The limit itself lives in the port's shared vocabulary; see the note there. */
export { MAX_MT5_ACCOUNTS } from '@/lib/mt5/types';

export type Mt5AccountView = {
  id: string;
  login: string;
  server: string;
  label: string | null;
  purpose: TradeStyle | null;
  status: Mt5Status;
  lastSyncAt: Date | null;
  accountCurrency: string | null;
  balance: number | null;
  equity: number | null;
  providerAccountId: string | null;
};

const VIEW_FIELDS = {
  id: true,
  login: true,
  server: true,
  label: true,
  purpose: true,
  status: true,
  lastSyncAt: true,
  accountCurrency: true,
  balance: true,
  equity: true,
  providerAccountId: true,
} as const;

function toView(row: {
  id: string;
  login: string;
  server: string;
  label: string | null;
  purpose: TradeStyle | null;
  status: Mt5Status;
  lastSyncAt: Date | null;
  accountCurrency: string | null;
  balance: unknown;
  equity: unknown;
  providerAccountId: string | null;
}): Mt5AccountView {
  return {
    id: row.id,
    login: row.login,
    server: row.server,
    label: row.label,
    purpose: row.purpose,
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    accountCurrency: row.accountCurrency,
    balance: row.balance === null ? null : Number(row.balance),
    equity: row.equity === null ? null : Number(row.equity),
    providerAccountId: row.providerAccountId,
  };
}

/*
 * Deduplicated per request, not cached across them.
 *
 * This was `unstable_cache` with a revalidate window, which is a different thing: that is a
 * shared data cache that survives the request, and nothing in the product invalidates it —
 * there is not a single `revalidateTag` call. Disconnecting a broker left the settings page
 * showing the account for another five minutes; a sync wrote a new balance and the dashboard
 * kept the old one under a pill claiming it had just synced; a rearranged dashboard could come
 * back in its previous arrangement for an hour. It also took the whole suite down with it,
 * because `unstable_cache` needs a request context that a test does not have.
 *
 * React's `cache` gets the part that was actually worth having — one query per request no
 * matter how many components ask — and cannot go stale, because it dies with the request.
 */
export const listMt5Accounts = cache(async (ctx: TenantContext): Promise<Mt5AccountView[]> => {
  assertContext(ctx);
  const rows = await prisma.mt5Account.findMany({
    // Disconnected rows survive to hold their trades' attribution; they are not connections,
    // so nothing that draws connections should see them.
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      investorPwEncrypted: { not: '' },
    },
    orderBy: { createdAt: 'asc' },
    select: VIEW_FIELDS,
  });
  return rows.map(toView);
});

/**
 * The first connected account, for the screens that still speak of "the" account.
 *
 * Kept so this change does not have to rewrite every caller at once, and ordered by creation
 * so it is stable rather than whichever row the planner happened to return. Anything that
 * shows figures per account should use `listMt5Accounts` instead.
 */
export const getMt5Account = cache(async (ctx: TenantContext): Promise<Mt5AccountView | null> => {
  const accounts = await listMt5Accounts(ctx);
  return accounts[0] ?? null;
});

/** Thrown rather than returned, so a caller cannot forget to check for it. */
export class Mt5AccountLimitError extends Error {
  constructor() {
    super(`A trader may connect at most ${MAX_MT5_ACCOUNTS} MT5 accounts.`);
    this.name = 'Mt5AccountLimitError';
  }
}

export async function connectMt5Account(
  ctx: TenantContext,
  data: {
    login: string;
    server: string;
    investorPwEncrypted: string;
    accountCurrency?: string;
    /** What the trader calls this one. Undefined leaves an existing label alone. */
    label?: string | null;
    /** What the account is for, which decides the style of everything it imports. */
    purpose?: TradeStyle | null;
  },
): Promise<Mt5AccountView> {
  assertContext(ctx);
  /*
   * Keyed on the broker account, not on the trader.
   *
   * It used to be `where: { userId }`, which was correct while a trader could only have one:
   * connecting a second account *replaced* the first, silently, and the first account's trades
   * were left behind pointing at a row that now described a different broker account. With two
   * accounts supported, connecting the swing account must add it rather than overwrite the day
   * one — so the same login at the same server is the same account and gets updated, and
   * anything else is a new row.
   */
  // Counted before the write, and only a *new* account is refused: reconnecting one of the
  // two — a changed password, a re-run of the wizard — must keep working at the limit.
  const existing = await prisma.mt5Account.findMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    select: { login: true, server: true },
  });
  const isNew = !existing.some(
    (account) => account.login === data.login && account.server === data.server,
  );
  if (isNew && existing.length >= MAX_MT5_ACCOUNTS) {
    throw new Mt5AccountLimitError();
  }

  const row = await prisma.mt5Account.upsert({
    where: {
      userId_login_server: { userId: ctx.userId, login: data.login, server: data.server },
    },
    create: {
      userId: ctx.userId,
      login: data.login,
      server: data.server,
      label: data.label ?? null,
      purpose: data.purpose ?? null,
      investorPwEncrypted: data.investorPwEncrypted,
      accountCurrency: data.accountCurrency ?? null,
      status: 'connected',
    },
    update: {
      investorPwEncrypted: data.investorPwEncrypted,
      accountCurrency: data.accountCurrency ?? null,
      status: 'connected',
      ...(data.label === undefined ? {} : { label: data.label }),
      ...(data.purpose === undefined ? {} : { purpose: data.purpose }),
    },
    select: VIEW_FIELDS,
  });
  return toView(row);
}

/**
 * The only path that returns the ciphertext. Named so that a reviewer grepping for where the
 * investor password can escape finds one call site.
 */
export async function readCredentialCiphertexts(ctx: TenantContext): Promise<
  {
    id: string;
    login: string;
    server: string;
    investorPwEncrypted: string;
    providerAccountId: string | null;
    purpose: TradeStyle | null;
    /** What the account is denominated in; null until its first successful sync. */
    accountCurrency: string | null;
  }[]
> {
  assertContext(ctx);
  return prisma.mt5Account.findMany({
    // A disconnected account keeps its row so its trades keep their attribution, but it has no
    // password and nothing to say to a broker.
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      investorPwEncrypted: { not: '' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      login: true,
      server: true,
      investorPwEncrypted: true,
      providerAccountId: true,
      purpose: true,
      accountCurrency: true,
    },
  });
}

export async function recordSyncSuccess(
  ctx: TenantContext,
  mt5AccountId: string,
  state: { currency: string; balance: number; equity: number; providerAccountId?: string | null },
): Promise<void> {
  assertContext(ctx);
  await prisma.mt5Account.updateMany({
    where: { id: mt5AccountId, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: {
      status: 'connected',
      lastSyncAt: new Date(),
      accountCurrency: state.currency,
      balance: state.balance,
      equity: state.equity,
      ...(state.providerAccountId ? { providerAccountId: state.providerAccountId } : {}),
    },
  });
}

export async function recordSyncFailure(ctx: TenantContext, mt5AccountId: string): Promise<void> {
  assertContext(ctx);
  await prisma.mt5Account.updateMany({
    where: { id: mt5AccountId, userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { status: 'error' },
  });
}

/**
 * Disconnects one account without losing what it was.
 *
 * This used to delete the row. Two things followed, both silent and both bad.
 *
 * The foreign key is `ON DELETE SET NULL`, so every trade the account had imported was left
 * with no account — and `upsertTrades` keys on `(user_id, mt5_account_id, ticket)`. Reconnect
 * the same broker account and it got a *new* id, so the upsert matched nothing and inserted a
 * second copy of the entire history: net P&L doubled, the trade count doubled, and the same
 * trade appeared in both the Day and Swing tabs at once.
 *
 * Worse, that nulling can violate the unique index itself. It is `NULLS NOT DISTINCT`, so two
 * accounts that both carried ticket `123` collide the moment the second one is disconnected
 * and its rows are nulled onto the first's — and the delete aborts with a constraint error the
 * trader sees as "something went wrong".
 *
 * So the row stays and the credential goes. The password is cleared, which is the part that
 * actually matters — keeping an investor password for an account somebody walked away from
 * serves nobody — and the trades keep pointing at a row that still describes the broker
 * account they came from. Reconnecting finds it by `(userId, login, server)` and adopts its
 * own history back.
 *
 * Passing no id disconnects every account, which is what account deletion wants.
 */
export async function disconnectMt5Account(
  ctx: TenantContext,
  mt5AccountId?: string,
): Promise<void> {
  assertContext(ctx);
  await prisma.mt5Account.updateMany({
    where: {
      userId: ctx.userId,
      user: { tenantId: ctx.tenantId },
      ...(mt5AccountId ? { id: mt5AccountId } : {}),
    },
    data: {
      status: 'disconnected',
      // Emptied, not kept. `readCredentialCiphertexts` skips a row with no ciphertext, so a
      // disconnected account cannot be synced even though it is still here.
      investorPwEncrypted: '',
    },
  });
}
