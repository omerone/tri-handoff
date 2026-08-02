/**
 * Redis client with graceful degradation
 *
 * Production-grade Redis integration with:
 * - Connection pooling and retry logic
 * - Graceful fallback to in-memory storage if Redis unavailable
 * - Health check endpoint
 * - Connection error logging
 * - Automatic reconnection
 */

import 'server-only';
import { RATE_LIMITS } from '@/config/rate-limits';

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exMs?: number): Promise<void>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ping(): Promise<string>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

// In-memory fallback storage for when Redis is unavailable
const inMemoryStore = new Map<
  string,
  {
    value: string;
    expiresAt: number;
  }
>();

// Track if Redis is available
let redisHealthy = false;
let redisClient: any = null;

/**
 * In-memory implementation of Redis client
 * Used as fallback when Redis is unavailable
 */
const createInMemoryClient = (): RedisClient => {
  const cleanupExpired = (key: string) => {
    const entry = inMemoryStore.get(key);
    if (entry && entry.expiresAt < Date.now()) {
      inMemoryStore.delete(key);
      return null;
    }
    return entry;
  };

  return {
    async get(key: string): Promise<string | null> {
      const entry = cleanupExpired(key);
      return entry?.value || null;
    },

    async set(key: string, value: string, exMs?: number): Promise<void> {
      const expiresAt = exMs ? Date.now() + exMs : Date.now() + 24 * 60 * 60 * 1000; // 24h default
      inMemoryStore.set(key, { value, expiresAt });
    },

    async del(key: string): Promise<number> {
      const existed = inMemoryStore.has(key);
      inMemoryStore.delete(key);
      return existed ? 1 : 0;
    },

    async incr(key: string): Promise<number> {
      const entry = cleanupExpired(key);
      const current = entry ? parseInt(entry.value, 10) : 0;
      const newValue = current + 1;
      // Keep the same expiration if it exists
      const expiresAt = entry?.expiresAt || Date.now() + 24 * 60 * 60 * 1000;
      inMemoryStore.set(key, { value: String(newValue), expiresAt });
      return newValue;
    },

    async expire(key: string, seconds: number): Promise<number> {
      const entry = inMemoryStore.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      inMemoryStore.set(key, entry);
      return 1;
    },

    async ping(): Promise<string> {
      return 'PONG';
    },

    async isHealthy(): Promise<boolean> {
      return true;
    },

    async close(): Promise<void> {
      // No-op for in-memory
    },
  };
};

/**
 * Create Redis client with retry logic
 */
const createRedisClient = async (): Promise<RedisClient | null> => {
  try {
    // Dynamically import Redis only if available
    const redis = await import('redis');
    const client = redis.createClient({
      host: RATE_LIMITS.redis.host,
      port: RATE_LIMITS.redis.port,
      password: RATE_LIMITS.redis.password,
      db: RATE_LIMITS.redis.db,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      socket: {
        reconnectStrategy: (retries: number) => {
          const delay = Math.min(retries * 50, 2000);
          return delay;
        },
      },
    });

    await client.connect?.();

    const wrappedClient: RedisClient = {
      async get(key: string): Promise<string | null> {
        const prefixedKey = `${RATE_LIMITS.redis.keyPrefix}${key}`;
        return client.get?.(prefixedKey) || null;
      },

      async set(key: string, value: string, exMs?: number): Promise<void> {
        const prefixedKey = `${RATE_LIMITS.redis.keyPrefix}${key}`;
        if (exMs) {
          await client.setEx?.(prefixedKey, Math.ceil(exMs / 1000), value);
        } else {
          await client.set?.(prefixedKey, value);
        }
      },

      async del(key: string): Promise<number> {
        const prefixedKey = `${RATE_LIMITS.redis.keyPrefix}${key}`;
        return (await client.del?.(prefixedKey)) || 0;
      },

      async incr(key: string): Promise<number> {
        const prefixedKey = `${RATE_LIMITS.redis.keyPrefix}${key}`;
        return (await client.incr?.(prefixedKey)) || 0;
      },

      async expire(key: string, seconds: number): Promise<number> {
        const prefixedKey = `${RATE_LIMITS.redis.keyPrefix}${key}`;
        return (await client.expire?.(prefixedKey, seconds)) || 0;
      },

      async ping(): Promise<string> {
        return (await client.ping?.()) || 'PONG';
      },

      async isHealthy(): Promise<boolean> {
        try {
          await this.ping();
          return true;
        } catch {
          return false;
        }
      },

      async close(): Promise<void> {
        await client.quit?.();
      },
    };

    redisClient = wrappedClient;
    redisHealthy = true;
    return wrappedClient;
  } catch (error) {
    console.warn('[Redis] Failed to initialize Redis client:', error);
    return null;
  }
};

/**
 * Get Redis client with fallback to in-memory storage
 */
export async function getRedisClient(): Promise<RedisClient> {
  if (redisClient && redisHealthy) {
    return redisClient;
  }

  if (!RATE_LIMITS.redis.fallbackEnabled) {
    throw new Error('[Redis] Redis unavailable and fallback disabled');
  }

  // Try to initialize Redis
  if (!redisClient) {
    const client = await createRedisClient();
    if (client) {
      return client;
    }
  }

  // Fall back to in-memory
  console.warn('[Redis] Using in-memory fallback for rate limiting');
  return createInMemoryClient();
}

/**
 * Health check for Redis connection
 */
export async function checkRedisHealth(): Promise<{
  healthy: boolean;
  mode: 'redis' | 'in-memory';
  message: string;
}> {
  try {
    const client = await getRedisClient();
    const isHealthy = await client.isHealthy();

    if (isHealthy && redisClient === client) {
      return {
        healthy: true,
        mode: 'redis',
        message: 'Redis connection healthy',
      };
    }

    return {
      healthy: true,
      mode: 'in-memory',
      message: 'Using in-memory fallback for rate limiting',
    };
  } catch (error) {
    return {
      healthy: false,
      mode: 'in-memory',
      message: `Rate limiting in degraded mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.close();
      redisClient = null;
      redisHealthy = false;
    } catch (error) {
      console.error('[Redis] Error closing client:', error);
    }
  }
}

// Initialize Redis on module load
let initializing = false;
export async function initializeRedis(): Promise<void> {
  if (initializing) return;
  initializing = true;
  try {
    await getRedisClient();
  } catch (error) {
    console.warn('[Redis] Initialization failed, will use in-memory fallback:', error);
  }
}
