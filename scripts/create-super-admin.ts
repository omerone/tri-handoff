/**
 * Creates or re-keys the platform operator account.
 *
 *   npm run admin:create -- --email you@example.com [--password ...]
 *
 * Re-running with an existing email resets that admin's password, which is the recovery
 * path if the operator locks themselves out (there is no self-service reset for admins).
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/crypto/password';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = arg('email');
  const password = arg('password') ?? randomBytes(16).toString('base64url');

  if (!email) {
    console.error('Usage: npm run admin:create -- --email <address> [--password <pw>]');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  const normalized = email.trim().toLowerCase();
  const existing = await prisma.superAdmin.findUnique({
    where: { email: normalized },
    select: { id: true },
  });

  await prisma.superAdmin.upsert({
    where: { email: normalized },
    update: { passwordHash: await hashPassword(password) },
    create: { email: normalized, passwordHash: await hashPassword(password) },
  });

  console.log(existing ? 'Super admin password reset.' : 'Super admin created.');
  console.log(`  email    : ${normalized}`);
  console.log(`  password : ${password}`);
  console.log('');
  console.log('Sign in at /admin/login on APP_BASE_DOMAIN. Client domains do not serve it.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
