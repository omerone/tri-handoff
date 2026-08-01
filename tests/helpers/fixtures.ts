import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { makeTenantContext } from '@/lib/db';
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
  if (created.length > 0) {
    // Cascades remove the user and everything hanging off it.
    await testDb.tenant.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
  await testDb.$disconnect();
}
