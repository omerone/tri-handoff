import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityLogger } from './logger';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    authEvent: {
      create: vi.fn(),
      count: vi.fn(),
    },
    dataAccessLog: {
      create: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
  },
}));

// Mock headers
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

// eslint-disable-next-line no-restricted-imports
import { prisma } from '@/lib/db/prisma';
import { headers } from 'next/headers';

describe('SecurityLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock headers response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (headers as any).mockResolvedValue({
      get: (name: string) => {
        const headerMap: Record<string, string | null> = {
          'x-forwarded-for': '192.168.1.100',
          'user-agent': 'Mozilla/5.0 (Testing)',
        };
        return headerMap[name] ?? null;
      },
    });
  });

  describe('logAuthEvent', () => {
    it('logs successful login', async () => {
      const createMock = vi.mocked(prisma.authEvent.create);
      createMock.mockResolvedValueOnce({
        id: '1',
        userId: 'user123',
        eventType: 'login_success',
        description: 'User logged in',
        result: 'success',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Testing)',
        details: {},
        createdAt: new Date(),
      });

      await SecurityLogger.logAuthEvent({
        userId: 'user123',
        eventType: 'login_success',
        description: 'User logged in',
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user123',
          eventType: 'login_success',
          description: 'User logged in',
          result: 'success',
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0 (Testing)',
        }),
      });
    });

    it('logs failed login with reason', async () => {
      const createMock = vi.mocked(prisma.authEvent.create);
      createMock.mockResolvedValueOnce({
        id: '2',
        userId: 'user123',
        eventType: 'login_failed',
        description: 'Failed login attempt',
        result: 'failure',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Testing)',
        details: { failureReason: 'wrong_password' },
        createdAt: new Date(),
      });

      await SecurityLogger.logAuthEvent({
        userId: 'user123',
        eventType: 'login_failed',
        description: 'Failed login attempt',
        result: 'failure',
        failureReason: 'wrong_password',
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user123',
          result: 'failure',
          details: { failureReason: 'wrong_password' },
        }),
      });
    });

    it('checks failed login threshold', async () => {
      const createMock = vi.mocked(prisma.authEvent.create);
      const countMock = vi.mocked(prisma.authEvent.count);

      createMock.mockResolvedValueOnce({
        id: '3',
        userId: 'user123',
        eventType: 'login_failed',
        description: 'Failed login attempt',
        result: 'failure',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Testing)',
        details: { failureReason: 'wrong_password' },
        createdAt: new Date(),
      });

      countMock.mockResolvedValueOnce(5); // 5 failed logins in 30 mins

      // Should trigger threshold check
      await SecurityLogger.logAuthEvent({
        userId: 'user123',
        eventType: 'login_failed',
        description: 'Failed login attempt',
        result: 'failure',
      });

      // Verify count was called to check threshold
      expect(countMock).toHaveBeenCalledWith({
        where: {
          userId: 'user123',
          eventType: 'login_failed',
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
    });
  });

  describe('logDataAccess', () => {
    it('logs user data export', async () => {
      const createMock = vi.mocked(prisma.dataAccessLog.create);
      createMock.mockResolvedValueOnce({
        id: '4',
        userId: 'user123',
        action: 'export',
        resource: 'user_profile',
        recordCount: 1,
        dataSizeBytes: 5000,
        ipAddress: '192.168.1.100',
        createdAt: new Date(),
      });

      await SecurityLogger.logDataAccess({
        userId: 'user123',
        action: 'export',
        resource: 'user_profile',
        recordCount: 1,
        dataSizeBytes: 5000,
      });

      expect(createMock).toHaveBeenCalledWith({
        data: {
          userId: 'user123',
          action: 'export',
          resource: 'user_profile',
          recordCount: 1,
          dataSizeBytes: 5000,
          ipAddress: '192.168.1.100',
        },
      });
    });

    it('logs large data access', async () => {
      const createMock = vi.mocked(prisma.dataAccessLog.create);
      createMock.mockResolvedValueOnce({
        id: '5',
        userId: 'user123',
        action: 'export',
        resource: 'trades',
        recordCount: 1000,
        dataSizeBytes: 50_000_000, // 50 MB - large!
        ipAddress: '192.168.1.100',
        createdAt: new Date(),
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await SecurityLogger.logDataAccess({
        userId: 'user123',
        action: 'export',
        resource: 'trades',
        recordCount: 1000,
        dataSizeBytes: 50_000_000,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Large data export')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('logAdminAction', () => {
    it('logs admin tenant creation', async () => {
      const createMock = vi.mocked(prisma.adminAuditLog.create);
      createMock.mockResolvedValueOnce({
        id: '6',
        adminId: 'admin1',
        tenantId: 'tenant123',
        userId: null,
        actionType: 'create_tenant',
        description: 'Created new tenant',
        changes: null,
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Testing)',
        createdAt: new Date(),
      });

      await SecurityLogger.logAdminAction({
        adminId: 'admin1',
        tenantId: 'tenant123',
        actionType: 'create_tenant',
        description: 'Created new tenant',
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adminId: 'admin1',
          tenantId: 'tenant123',
          actionType: 'create_tenant',
          description: 'Created new tenant',
        }),
      });
    });

    it('logs admin action with changes', async () => {
      const createMock = vi.mocked(prisma.adminAuditLog.create);
      createMock.mockResolvedValueOnce({
        id: '7',
        adminId: 'admin1',
        tenantId: 'tenant123',
        userId: null,
        actionType: 'update_config',
        description: 'Updated tenant configuration',
        changes: '{"status":{"from":"active","to":"suspended"}}',
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Testing)',
        createdAt: new Date(),
      });

      const changes = {
        status: {
          from: 'active',
          to: 'suspended',
        },
      };

      await SecurityLogger.logAdminAction({
        adminId: 'admin1',
        tenantId: 'tenant123',
        actionType: 'update_config',
        description: 'Updated tenant configuration',
        changes,
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changes: JSON.stringify(changes),
        }),
      });
    });
  });

  describe('Error handling', () => {
    it('does not throw on database errors', async () => {
      const createMock = vi.mocked(prisma.authEvent.create);
      createMock.mockRejectedValueOnce(new Error('Database error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await SecurityLogger.logAuthEvent({
        userId: 'user123',
        eventType: 'login_success',
        description: 'User logged in',
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to log auth event:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});
