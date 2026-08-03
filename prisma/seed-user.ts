import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/crypto/password';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { domain: 'demo.localhost' }
  });
  
  if (!tenant) {
    console.error('❌ Tenant not found');
    return;
  }

  const passwordHash = await hashPassword('TriDemo2026!');
  
  const user = await prisma.user.upsert({
    where: { tenantId: tenant.id },
    update: { passwordHash },
    create: {
      tenantId: tenant.id,
      email: 'demo@tri.local',
      passwordHash,
      locale: 'he',
      displayCurrency: 'ILS',
    },
  });

  console.log('✅ User created:', user.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());
