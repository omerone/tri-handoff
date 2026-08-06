/**
 * Change the sign-in address and password of an existing tenant's trader.
 *
 *   npm run tenant:credentials -- --domain 167.233.250.233 --email someone@example.com
 *
 * `tenant:create` onboards a *new* client and cannot help here: a tenant is identified by its
 * domain and there is only one of those per deployment, so handing an existing installation to
 * a real person means editing the account that is already on it, not adding a second.
 *
 * Omit `--password` and a strong one is generated. It is printed exactly once, here, and never
 * stored in plaintext — send it over a channel the person already trusts.
 *
 * **Every existing session is destroyed.** A password change that leaves old cookies working
 * is not a password change: the whole reason to rotate one is that somebody may be holding the
 * old credential, and a live session is the old credential.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
} from '../src/lib/crypto/password';
import { normalizeDomain } from '../src/lib/tenant/domain';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * A password nobody has to remember, so it may as well be long.
 *
 * 24 base64url characters is about 143 bits from the system CSPRNG — far past anything a
 * strength meter has an opinion about, and past anything that can be attacked offline even if
 * the hash leaks. Grouped into blocks of six so it can be read aloud or typed off a screen
 * without losing your place; the hyphens count toward nothing and cost nothing.
 */
function generatePassword(): string {
  const raw = randomBytes(18).toString('base64url');
  return (raw.match(/.{1,6}/g) ?? [raw]).join('-');
}

async function main() {
  const domainInput = arg('domain');
  const email = arg('email')?.trim().toLowerCase();
  const password = arg('password') ?? generatePassword();

  if (!domainInput || !email) {
    console.error(
      'Usage: npm run tenant:credentials -- --domain <host> --email <address> [--password <pw>]',
    );
    process.exitCode = 1;
    return;
  }

  const domain = normalizeDomain(domainInput);
  if (!domain) {
    console.error(`Not a usable domain: ${domainInput}`);
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  // The same check the sign-up form applies — it throws on a weak one. A generated password
  // sails through; a typed one is exactly the case worth refusing here rather than at the
  // login screen. The email goes in as a user input so a password built from it is rejected.
  try {
    validatePasswordStrength(password, [email]);
  } catch (error) {
    console.error(`Password rejected: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { domain },
    select: { id: true, name: true, user: { select: { id: true, email: true } } },
  });

  if (!tenant?.user) {
    console.error(`No trader on ${domain}. Use \`npm run tenant:create\` to onboard one.`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  const [, removed] = await prisma.$transaction([
    prisma.user.update({
      where: { id: tenant.user.id },
      data: { email, passwordHash },
    }),
    // Not "log them out": invalidate whatever is already signed in. Anyone holding a cookie
    // issued against the old password is holding the credential this command exists to retire.
    prisma.session.deleteMany({ where: { userId: tenant.user.id } }),
  ]);

  console.log(`\nTenant   ${tenant.name} (${domain})`);
  console.log(`Was      ${tenant.user.email}`);
  console.log(`Now      ${email}`);
  console.log(`Password ${password}`);
  console.log(`\n${removed.count} existing session(s) invalidated.`);
  console.log('Shown once. It is stored only as a hash — send it over a trusted channel.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
