import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUser, updateUserPreferences } from '@/lib/db';
import { findUserForLogin, lookupTenantByDomain, provisionTenant } from '@/lib/db/unscoped';
import { assertContext, makeTenantContext } from '@/lib/db/context';
import { cleanup, createTenantFixture, crossTenantContext, testDb, type Fixture } from '../helpers/fixtures';

/**
 * Tenant isolation is the single security property the whole distribution model rests on:
 * one database serves every client, so a query that forgets its scope leaks one trader's
 * book to another. These tests attack the data layer with a context that pairs one
 * tenant's id with another tenant's user id and assert that nothing comes back.
 *
 * Requires the development database: `docker compose up -d postgres && npm run db:migrate`.
 */

let alice: Fixture;
let bob: Fixture;

beforeAll(async () => {
  alice = await createTenantFixture();
  bob = await createTenantFixture();
});

afterAll(cleanup);

describe('cross-tenant reads', () => {
  it('returns the user for their own context', async () => {
    const user = await getUser(alice.ctx);
    expect(user?.id).toBe(alice.userId);
    expect(user?.email).toBe(alice.email);
  });

  it("returns nothing when one tenant asks for another tenant's user", async () => {
    expect(await getUser(crossTenantContext(alice, bob))).toBeNull();
    expect(await getUser(crossTenantContext(bob, alice))).toBeNull();
  });

  it('returns nothing for a context whose user id does not exist', async () => {
    expect(await getUser(makeTenantContext(alice.tenantId, 'no-such-user'))).toBeNull();
  });
});

describe('cross-tenant writes', () => {
  it("does not modify another tenant's user", async () => {
    await updateUserPreferences(crossTenantContext(alice, bob), {
      locale: 'en',
      displayCurrency: 'USD',
    });

    const victim = await testDb.user.findUniqueOrThrow({ where: { id: bob.userId } });
    expect(victim.locale).toBe('he');
    expect(victim.displayCurrency).toBe('ILS');
  });

  it("does modify the caller's own user", async () => {
    await updateUserPreferences(alice.ctx, { locale: 'en', displayCurrency: 'USD' });

    const own = await testDb.user.findUniqueOrThrow({ where: { id: alice.userId } });
    expect(own.locale).toBe('en');
    expect(own.displayCurrency).toBe('USD');
  });
});

describe('login lookup', () => {
  it('finds the user on their own tenant', async () => {
    const found = await findUserForLogin(alice.tenantId, alice.email);
    expect(found?.id).toBe(alice.userId);
  });

  it('is case-insensitive on the email', async () => {
    const found = await findUserForLogin(alice.tenantId, alice.email.toUpperCase());
    expect(found?.id).toBe(alice.userId);
  });

  it("does not find a user through another tenant's domain", async () => {
    expect(await findUserForLogin(bob.tenantId, alice.email)).toBeNull();
  });
});

describe('assertContext', () => {
  it('rejects an empty or malformed context', () => {
    expect(() => assertContext({ tenantId: '', userId: 'u' } as never)).toThrow();
    expect(() => assertContext({ tenantId: 't', userId: '' } as never)).toThrow();
    expect(() => assertContext(undefined as never)).toThrow();
  });

  it('rejects a context built without both ids', () => {
    expect(() => makeTenantContext('', 'u')).toThrow();
    expect(() => makeTenantContext('t', '')).toThrow();
  });
});

describe('tenant lookup by host', () => {
  it('resolves an active tenant and normalises the host', async () => {
    const result = await lookupTenantByDomain(`${alice.domain.toUpperCase()}:443`);
    expect(result.state).toBe('active');
    expect(result.state === 'active' && result.tenant.id).toBe(alice.tenantId);
  });

  it('reports a suspended tenant separately from an unknown one', async () => {
    const suspended = await createTenantFixture({ status: 'suspended' });
    expect((await lookupTenantByDomain(suspended.domain)).state).toBe('suspended');
    expect((await lookupTenantByDomain('nobody.itest')).state).toBe('unknown');
    expect((await lookupTenantByDomain('')).state).toBe('unknown');
  });
});

describe('provisioning', () => {
  it('rejects an invalid domain and a duplicate domain', async () => {
    expect(
      await provisionTenant({
        name: 'Bad',
        domain: 'not a domain',
        email: 'x@example.test',
        passwordHash: 'h',
      }),
    ).toEqual({ ok: false, reason: 'invalid-domain' });

    expect(
      await provisionTenant({
        name: 'Dup',
        domain: alice.domain,
        email: 'x@example.test',
        passwordHash: 'h',
      }),
    ).toEqual({ ok: false, reason: 'domain-taken' });
  });
});
