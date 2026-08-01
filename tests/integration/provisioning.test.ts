import { afterAll, describe, expect, it } from 'vitest';
import { findUserForLogin, lookupTenantByDomain, provisionTenant } from '@/lib/db/unscoped';
import { cleanup, reserveDomain, testDb } from '../helpers/fixtures';

/**
 * Tenant provisioning — the CLI and the operator panel both call `provisionTenant`.
 *
 * Two things make this worth testing beyond the happy path. The domain is the tenant's only
 * identity, so anything that lets the same host be stored twice (or stored in a shape the
 * Host header will never match) breaks resolution for a paying client. And the tenant and
 * its single user are created in one transaction, so a failure must leave nothing behind:
 * a tenant without a user is a domain that resolves and can never be logged into.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

afterAll(cleanup);

const hash = 'not-a-real-argon2-hash';

describe('domain handling', () => {
  it('normalises the host before storing it, so the Host header matches', async () => {
    const domain = reserveDomain();
    const result = await provisionTenant({
      name: 'Mixed Case',
      domain: `HTTPS://${domain.toUpperCase()}:443/admin`,
      email: 'ops@example.test',
      passwordHash: hash,
    });

    expect(result).toMatchObject({ ok: true, domain });
    expect((await lookupTenantByDomain(domain)).state).toBe('active');
  });

  // The duplicate check runs on the normalised form. If it ever ran on the raw input, the
  // second create would reach the database and hit the unique index — a P2002 for the
  // operator instead of a readable error, and worse, an operator convinced the two hosts
  // are different clients.
  it('rejects a duplicate written in a different shape', async () => {
    const domain = reserveDomain();
    expect(await provisionTenant({ name: 'A', domain, email: 'a@example.test', passwordHash: hash }))
      .toMatchObject({ ok: true });

    expect(
      await provisionTenant({
        name: 'B',
        domain: `${domain.toUpperCase()}:8443`,
        email: 'b@example.test',
        passwordHash: hash,
      }),
    ).toEqual({ ok: false, reason: 'domain-taken' });

    expect(await testDb.tenant.count({ where: { domain } })).toBe(1);
  });

  it('rejects hosts the middleware could never resolve', async () => {
    const invalid = [
      '',
      '   ',
      'has space.app',
      '-leading.app',
      'trailing-.app',
      'double..dot',
      'under_score.app',
      `${'a'.repeat(64)}.app`, // a label may be 63 characters
    ];
    for (const domain of invalid) {
      expect(
        await provisionTenant({ name: 'X', domain, email: 'x@example.test', passwordHash: hash }),
        domain,
      ).toEqual({ ok: false, reason: 'invalid-domain' });
    }
  });

  it('creates nothing when the domain is rejected', async () => {
    const domain = reserveDomain();
    await provisionTenant({
      name: 'X',
      domain: `not a domain ${domain}`,
      email: 'x@example.test',
      passwordHash: hash,
    });
    // Scoped to this test's slug rather than a total count: other test files provision
    // tenants against the same database at the same time.
    expect(await testDb.tenant.count({ where: { domain: { contains: domain } } })).toBe(0);
  });
});

describe('the user created alongside the tenant', () => {
  it('is stored lowercased and trimmed, so login matches what was typed', async () => {
    const domain = reserveDomain();
    const result = await provisionTenant({
      name: 'Yossi',
      domain,
      email: '  Yossi.Cohen@Example.TEST  ',
      passwordHash: hash,
    });
    expect(result.ok).toBe(true);

    const tenantId = result.ok ? result.tenantId : '';
    const user = await testDb.user.findFirstOrThrow({ where: { tenantId } });
    expect(user.email).toBe('yossi.cohen@example.test');
    expect(await findUserForLogin(tenantId, 'YOSSI.COHEN@EXAMPLE.TEST')).toMatchObject({
      id: user.id,
    });
  });

  it('defaults to Hebrew and shekels, and honours an override', async () => {
    const defaults = await provisionTenant({
      name: 'Defaults',
      domain: reserveDomain(),
      email: 'd@example.test',
      passwordHash: hash,
    });
    expect(defaults.ok).toBe(true);
    expect(
      await testDb.user.findFirstOrThrow({ where: { tenantId: defaults.ok ? defaults.tenantId : '' } }),
    ).toMatchObject({ locale: 'he', displayCurrency: 'ILS' });

    const overridden = await provisionTenant({
      name: 'Override',
      domain: reserveDomain(),
      email: 'o@example.test',
      passwordHash: hash,
      locale: 'en',
      displayCurrency: 'USD',
    });
    expect(overridden.ok).toBe(true);
    expect(
      await testDb.user.findFirstOrThrow({
        where: { tenantId: overridden.ok ? overridden.tenantId : '' },
      }),
    ).toMatchObject({ locale: 'en', displayCurrency: 'USD' });
  });

  // Emails are unique per tenant, not globally: the same person can be the user of two
  // client domains, and one client must not be able to squat an address for everyone else.
  it('allows the same address on a second tenant', async () => {
    const email = 'shared@example.test';
    const first = await provisionTenant({
      name: 'First',
      domain: reserveDomain(),
      email,
      passwordHash: hash,
    });
    const second = await provisionTenant({
      name: 'Second',
      domain: reserveDomain(),
      email,
      passwordHash: hash,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe('naming', () => {
  it('falls back to the domain when the operator leaves the name blank', async () => {
    const domain = reserveDomain();
    const result = await provisionTenant({
      name: '   ',
      domain,
      email: 'blank@example.test',
      passwordHash: hash,
    });

    expect(result.ok).toBe(true);
    // The name is rendered in the shell footer; an empty header is worse than the domain.
    expect(await testDb.tenant.findUniqueOrThrow({ where: { domain } })).toMatchObject({
      name: domain,
    });
  });
});

describe('concurrent provisioning of the same domain', () => {
  /**
   * The pre-flight `findUnique` cannot stop two operators submitting the form at the same
   * instant; the unique index does, and the transaction is what keeps the loser from
   * leaving a tenant row with no user behind it.
   *
   * Prisma logs the unique violation it raises before `provisionTenant` catches it — the
   * `prisma:error` lines this test prints are the mechanism working, not a failure.
   */
  it('lets exactly one through and leaves no half-created client', async () => {
    const domain = reserveDomain();
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        provisionTenant({
          name: `Race ${n}`,
          domain,
          email: `race-${n}@example.test`,
          passwordHash: hash,
        }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const loser of results.filter((r) => !r.ok)) {
      expect(loser).toEqual({ ok: false, reason: 'domain-taken' });
    }

    const tenants = await testDb.tenant.findMany({
      where: { domain },
      include: { user: true },
    });
    expect(tenants).toHaveLength(1);
    expect(tenants[0]?.user).not.toBeNull();
  });
});
