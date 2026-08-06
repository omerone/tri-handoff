import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { makeTenantContext } from '@/lib/db/unscoped';
import type { TenantContext } from '@/lib/tenant/context';

/**
 * Integration-test fixtures.
 *
 * These talk to the development database directly (not through the repositories) so that a
 * bug in a repository cannot also corrupt the fixture it is being tested against. Every
 * tenant created here uses a `t-<random>.itest` domain and is deleted in `cleanup()`.
 */

export const testDb = new PrismaClient();

export type Fixture = {
  tenantId: string;
  userId: string;
  domain: string;
  email: string;
  ctx: TenantContext;
};

const created: string[] = [];
const claimedDomains: string[] = [];

/**
 * A free `.itest` hostname, registered for deletion in `cleanup()`.
 *
 * Tests that provision through the repository rather than through `createTenantFixture`
 * have no tenant id to hand back until the call succeeds — and a provisioning bug could
 * leave a row behind after a call that *failed*. Claiming the domain up front means cleanup
 * catches that row too.
 */
export function reserveDomain(): string {
  const domain = `t-${randomBytes(6).toString('hex')}.itest`;
  claimedDomains.push(domain);
  return domain;
}

export async function createTenantFixture(
  overrides: { status?: 'active' | 'suspended' } = {},
): Promise<Fixture> {
  const slug = randomBytes(6).toString('hex');
  const domain = `t-${slug}.itest`;
  const email = `user-${slug}@example.test`;

  const tenant = await testDb.tenant.create({
    data: { name: `Fixture ${slug}`, domain, status: overrides.status ?? 'active' },
  });
  created.push(tenant.id);

  const user = await testDb.user.create({
    data: {
      tenantId: tenant.id,
      email,
      // Not a real hash — nothing in these tests verifies a password.
      passwordHash: `fixture-hash-${slug}`,
      locale: 'he',
      displayCurrency: 'ILS',
    },
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    domain,
    email,
    ctx: makeTenantContext(tenant.id, user.id),
  };
}

/** Forges a context pointing at another tenant's user — the attack the repositories must block. */
export function crossTenantContext(attacker: Fixture, victim: Fixture): TenantContext {
  return makeTenantContext(attacker.tenantId, victim.userId);
}

export async function cleanup(): Promise<void> {
  if (created.length > 0 || claimedDomains.length > 0) {
    // Cascades remove the user and everything hanging off it.
    await testDb.tenant.deleteMany({
      where: { OR: [{ id: { in: created } }, { domain: { in: claimedDomains } }] },
    });
    created.length = 0;
    claimedDomains.length = 0;
  }
  await testDb.$disconnect();
}

/**
 * A connected broker account for a fixture, and the id trades hang off.
 *
 * `upsertTrades` takes an account because two brokers can issue the same position ticket and
 * the key has to tell them apart. Tests that only care about trades existing should not have
 * to know that, so this is one line at the top of them.
 */
export async function connectAccountFixture(
  fixture: Fixture,
  over: { login?: string; server?: string; label?: string } = {},
): Promise<string> {
  const row = await testDb.mt5Account.create({
    data: {
      userId: fixture.userId,
      login: over.login ?? '50214437',
      server: over.server ?? 'MetaQuotes-Demo',
      label: over.label ?? null,
      investorPwEncrypted: 'v1.test.ciphertext',
      accountCurrency: 'USD',
      status: 'connected',
    },
    select: { id: true },
  });
  return row.id;
}
