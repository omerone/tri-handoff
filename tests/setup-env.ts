/**
 * Deterministic environment for unit tests. Loaded before any test module, so modules that
 * validate `process.env` at import time (src/lib/env.ts) see a complete configuration
 * without depending on a developer's local .env.
 *
 * The local .env is still loaded first when it exists, because the integration tests under
 * tests/integration need a real DATABASE_URL. They run against the development database
 * (`docker compose up -d postgres`) and clean up every row they create.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Cast: @types/node declares NODE_ENV read-only, but a test bootstrap is exactly the place
// that is allowed to set it.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://tri:tri@localhost:5433/tri?schema=public';
process.env.SESSION_SECRET ??= Buffer.alloc(48, 7).toString('base64');
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString('base64');
process.env.MT5_PROVIDER ??= 'mock';
process.env.FX_API_URL ??= 'https://api.frankfurter.app';
process.env.APP_BASE_DOMAIN ??= 'localhost:3000';
process.env.APP_PROTOCOL ??= 'http';
