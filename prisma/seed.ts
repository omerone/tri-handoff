/**
 * Development seed: one demo tenant, its single user, and a super admin.
 *
 * Idempotent — safe to re-run. Passwords are read from the environment when provided so a
 * staging seed doesn't ship with a known password; otherwise a local-only default is used
 * and printed.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto/password';
import { normalizeDomain } from '../src/lib/tenant/domain';

const prisma = new PrismaClient();

const DEMO_DOMAIN = normalizeDomain(process.env.SEED_DOMAIN ?? 'demo.localhost');
const DEMO_EMAIL = (process.env.SEED_EMAIL ?? 'demo@tri.local').toLowerCase();
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'TriDemo2026!';
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@tri.local').toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'TriAdmin2026!';

async function main() {
  // The demo household mirrors the first real client — two people, one login — because the
  // e2e suite exercises the member switch and the per-member split against this tenant.
  const HOUSEHOLD = ['יוני', 'אביתר'];
  const tenant = await prisma.tenant.upsert({
    where: { domain: DEMO_DOMAIN },
    update: { household: HOUSEHOLD },
    create: { name: 'Demo Trader', domain: DEMO_DOMAIN, status: 'active', household: HOUSEHOLD },
  });

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.user.upsert({
    where: { tenantId: tenant.id },
    update: { email: DEMO_EMAIL, passwordHash },
    create: {
      tenantId: tenant.id,
      email: DEMO_EMAIL,
      passwordHash,
      locale: 'he',
      displayCurrency: 'ILS',
    },
  });

  const adminHash = await hashPassword(ADMIN_PASSWORD);
  await prisma.superAdmin.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash: adminHash },
    create: { email: ADMIN_EMAIL, passwordHash: adminHash },
  });

  console.log('Seeded.');
  console.log(`  tenant : http://${DEMO_DOMAIN}:3000`);
  console.log(`  user   : ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  admin  : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(
    `           sign in at ${process.env.APP_PROTOCOL ?? 'http'}://${process.env.APP_BASE_DOMAIN ?? 'localhost:3000'}/admin/login`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
