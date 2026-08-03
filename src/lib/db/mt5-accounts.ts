import 'server-only';
import { unstable_cache } from 'next/cache';
import type { Mt5Status } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import { assertContext } from './context';
import { prisma } from './prisma';

/**
 * The MT5 account, one per user (SPEC §3.3).
 *
 * The stored investor password is the most sensitive thing in the database, so it leaves
 * this module by exactly one door: `readCredentialCiphertext`, which the sync uses and
 * nothing else. Every other read returns `Mt5AccountView`, which has no field it could hide
 * in — a page cannot accidentally serialise it into the HTML, because it never has it.
 */

export type Mt5AccountView = {
  id: string;
  login: string;
  server: string;
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
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    accountCurrency: row.accountCurrency,
    balance: row.balance === null ? null : Number(row.balance),
    equity: row.equity === null ? null : Number(row.equity),
    providerAccountId: row.providerAccountId,
  };
}

export const getMt5Account = unstable_cache(
  async (ctx: TenantContext): Promise<Mt5AccountView | null> => {
    assertContext(ctx);
    const row = await prisma.mt5Account.findFirst({
      where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
      select: VIEW_FIELDS,
    });
    return row ? toView(row) : null;
  },
  ['mt5-account'],
  { revalidate: 300, tags: ['mt5-account'] },
);

export async function connectMt5Account(
  ctx: TenantContext,
  data: { login: string; server: string; investorPwEncrypted: string; accountCurrency?: string },
): Promise<Mt5AccountView> {
  assertContext(ctx);
  const row = await prisma.mt5Account.upsert({
    where: { userId: ctx.userId },
    create: {
      userId: ctx.userId,
      login: data.login,
      server: data.server,
      investorPwEncrypted: data.investorPwEncrypted,
      accountCurrency: data.accountCurrency ?? null,
      status: 'connected',
    },
    update: {
      login: data.login,
      server: data.server,
      investorPwEncrypted: data.investorPwEncrypted,
      accountCurrency: data.accountCurrency ?? null,
      status: 'connected',
      // A different account means the old history no longer belongs to it; the caller
      // clears the trades in the same transaction.
      lastSyncAt: null,
    },
    select: VIEW_FIELDS,
  });
  return toView(row);
}

/**
 * The only path that returns the ciphertext. Named so that a reviewer grepping for where the
 * investor password can escape finds one call site.
 */
export async function readCredentialCiphertext(ctx: TenantContext): Promise<{
  login: string;
  server: string;
  investorPwEncrypted: string;
  providerAccountId: string | null;
} | null> {
  assertContext(ctx);
  return prisma.mt5Account.findFirst({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    select: { login: true, server: true, investorPwEncrypted: true, providerAccountId: true },
  });
}

export async function recordSyncSuccess(
  ctx: TenantContext,
  state: { currency: string; balance: number; equity: number; providerAccountId?: string | null },
): Promise<void> {
  assertContext(ctx);
  await prisma.mt5Account.updateMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
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

export async function recordSyncFailure(ctx: TenantContext): Promise<void> {
  assertContext(ctx);
  await prisma.mt5Account.updateMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
    data: { status: 'error' },
  });
}

export async function disconnectMt5Account(ctx: TenantContext): Promise<void> {
  assertContext(ctx);
  // Delete rather than mark disconnected: keeping an encrypted password for an account the
  // user has walked away from serves nobody. The trades stay — they are the user's journal,
  // not the broker's.
  await prisma.mt5Account.deleteMany({
    where: { userId: ctx.userId, user: { tenantId: ctx.tenantId } },
  });
}
