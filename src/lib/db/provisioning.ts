import 'server-only';
import type { Locale } from '@/i18n/config';
import { isValidDomain, normalizeDomain } from '@/lib/tenant/domain';
import { prisma } from './prisma';

export type ProvisionInput = {
  name: string;
  domain: string;
  email: string;
  passwordHash: string;
  locale?: Locale;
  displayCurrency?: string;
};

export type ProvisionResult =
  | { ok: true; tenantId: string; userId: string; domain: string }
  | { ok: false; reason: 'invalid-domain' | 'domain-taken' | 'reserved-domain' };

/**
 * Hosts a client may not be given.
 *
 * The platform's own base domain serves the operator panel. Handing it to a client would put
 * their app and `/admin` on one origin, where they share a cookie jar and the host check
 * that hides the panel from clients stops meaning anything.
 *
 * Read straight from `process.env` rather than through `env()` so this module stays usable
 * from the provisioning CLI, which runs without the app's full configuration.
 */
function reservedDomains(): string[] {
  const base = process.env.APP_BASE_DOMAIN;
  return base ? [normalizeDomain(base)].filter(Boolean) : [];
}

/**
 * Creates a client: one tenant plus its single user, in one transaction so a half-created
 * client can never exist. This is the "minimal tenant provisioning" P0 needs in order to
 * onboard the first customer, and the admin panel in P4 calls the same function.
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const domain = normalizeDomain(input.domain);
  if (!isValidDomain(domain)) return { ok: false, reason: 'invalid-domain' };
  if (reservedDomains().includes(domain)) return { ok: false, reason: 'reserved-domain' };

  const existing = await prisma.tenant.findUnique({ where: { domain }, select: { id: true } });
  if (existing) return { ok: false, reason: 'domain-taken' };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: input.name.trim() || domain, domain, status: 'active' },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email.trim().toLowerCase(),
          passwordHash: input.passwordHash,
          locale: input.locale ?? 'he',
          displayCurrency: input.displayCurrency ?? 'ILS',
        },
      });
      return { tenantId: tenant.id, userId: user.id };
    });
    return { ok: true, domain, ...result };
  } catch (error) {
    // Unique violation from a concurrent create of the same domain.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { ok: false, reason: 'domain-taken' };
    }
    throw error;
  }
}
