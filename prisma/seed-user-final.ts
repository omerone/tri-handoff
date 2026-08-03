import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { domain: 'demo.localhost' }
  });
  
  if (!tenant) {
    console.error('❌ Tenant not found');
    return;
  }

  const passwordHash = await hash('TriDemo2026!');
  
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
