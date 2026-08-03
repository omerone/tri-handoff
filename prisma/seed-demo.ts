import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { domain: 'demo.localhost' },
    update: {},
    create: { 
      name: 'Demo Trader', 
      domain: 'demo.localhost', 
      status: 'active' 
    },
  });
  console.log('✅ Tenant created:', tenant.id);
}

main().catch(console.error).finally(() => prisma.$disconnect());
