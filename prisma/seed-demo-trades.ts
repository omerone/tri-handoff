/**
 * Seed sample trades for demo account to showcase UI
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'demo@tri.local' },
  });

  if (!user) {
    console.error('Demo user not found. Run seed.ts first.');
    process.exit(1);
  }

  const now = new Date();
  const sampleTrades = [
    {
      userId: user.id,
      ticket: '1001',
      kind: 'trade' as const,
      symbol: 'EURUSD',
      assetClass: 'forex' as const,
      direction: 'long' as const,
      style: 'day' as const,
      openAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      closeAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000),
      volume: 1,
      entryPrice: 1.0850,
      exitPrice: 1.0920,
      sl: 1.0800,
      tp: 1.0950,
      commission: 5,
      swap: 0.5,
      profit: 700,
      risk: 500,
      rr: 1.4,
      strategy: 'Breakout',
    },
    {
      userId: user.id,
      ticket: '1002',
      kind: 'trade' as const,
      symbol: 'GBPUSD',
      assetClass: 'forex' as const,
      direction: 'short' as const,
      style: 'swing' as const,
      openAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      closeAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      volume: 0.5,
      entryPrice: 1.2680,
      exitPrice: 1.2600,
      sl: 1.2750,
      tp: 1.2500,
      commission: 3,
      swap: -2,
      profit: 400,
      risk: 350,
      rr: 1.14,
      strategy: 'Support/Resistance',
    },
    {
      userId: user.id,
      ticket: '1003',
      kind: 'trade' as const,
      symbol: 'USDJPY',
      assetClass: 'forex' as const,
      direction: 'long' as const,
      style: 'day' as const,
      openAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      closeAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      volume: 2,
      entryPrice: 149.50,
      exitPrice: 149.10,
      sl: 149.80,
      tp: 148.50,
      commission: 8,
      swap: 1,
      profit: -800,
      risk: 600,
      rr: -1.33,
      strategy: 'Trend Following',
    },
    {
      userId: user.id,
      ticket: '1004',
      kind: 'trade' as const,
      symbol: 'GOLD',
      assetClass: 'indices' as const,
      direction: 'long' as const,
      style: 'swing' as const,
      openAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
      closeAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      volume: 10,
      entryPrice: 2520,
      exitPrice: 2580,
      sl: 2500,
      tp: 2600,
      commission: 15,
      swap: 5,
      profit: 6000,
      risk: 200,
      rr: 30,
      strategy: 'Momentum',
    },
    {
      userId: user.id,
      ticket: '1005',
      kind: 'trade' as const,
      symbol: 'BTC',
      assetClass: 'crypto' as const,
      direction: 'long' as const,
      style: 'day' as const,
      openAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      closeAt: now,
      volume: 0.1,
      entryPrice: 62000,
      exitPrice: 63500,
      sl: 61000,
      tp: 64000,
      commission: 20,
      swap: 0,
      profit: 1500,
      risk: 1000,
      rr: 1.5,
      strategy: 'Scalping',
    },
  ];

  for (const trade of sampleTrades) {
    await prisma.trade.upsert({
      where: { userId_ticket: { userId: user.id, ticket: trade.ticket } },
      update: {},
      create: trade,
    });
  }

  console.log('✓ Seeded 5 sample trades for demo account');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
