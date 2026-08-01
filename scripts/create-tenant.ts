/**
 * Onboards a client from the command line.
 *
 *   npm run tenant:create -- --name "Yossi Cohen" --domain yossi.tri.app --email yossi@example.com
 *
 * Omit --password and one is generated and printed. The password is shown exactly once,
 * here, and never stored in plaintext — send it over a channel the client already trusts and
 * have them reset it on first login.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto/password';
import { isValidDomain, normalizeDomain } from '../src/lib/tenant/domain';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function generatePassword(): string {
  // 18 base64url chars ≈ 107 bits — plenty for a credential that is reset on first use.
  return randomBytes(14).toString('base64url');
}

async function main() {
  const name = arg('name');
  const domainInput = arg('domain');
  const email = arg('email');
  const password = arg('password') ?? generatePassword();
  const locale = arg('locale') === 'en' ? 'en' : 'he';
  const currency = arg('currency') ?? 'ILS';

  if (!domainInput || !email) {
    console.error(
      'Usage: npm run tenant:create -- --domain <host> --email <address> [--name <name>] [--password <pw>] [--locale he|en] [--currency ILS|USD|EUR|GBP]',
    );
    process.exitCode = 1;
    return;
  }

  const domain = normalizeDomain(domainInput);
  if (!isValidDomain(domain)) {
    console.error(`"${domainInput}" is not a valid hostname.`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.tenant.findUnique({ where: { domain }, select: { id: true } });
  if (existing) {
    console.error(`${domain} is already assigned to a client.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  const { tenant } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { name: name?.trim() || domain, domain, status: 'active' },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: email.trim().toLowerCase(),
        passwordHash,
        locale,
        displayCurrency: currency,
      },
    });
    return { tenant };
  });

  console.log('Client created.');
  console.log(`  domain   : ${tenant.domain}`);
  console.log(`  email    : ${email.trim().toLowerCase()}`);
  console.log(`  password : ${password}`);
  console.log('');
  console.log('Next: point the domain at this server. Caddy requests a certificate on the');
  console.log('first request, after checking the domain against the tenants table.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
