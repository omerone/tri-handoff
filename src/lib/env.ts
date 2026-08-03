import 'server-only';
import { z } from 'zod';
import { loadSecrets } from '@/lib/secrets/manager';

/**
 * Server-side environment. Validated once at first import so a misconfigured
 * deployment fails loudly at boot instead of at the first request that needs a secret.
 *
 * Nothing in this module may ever be imported from a client component — the
 * `server-only` import above turns that into a build error.
 *
 * Secrets are loaded from:
 * 1. AWS Secrets Manager (production)
 * 2. .env.local (local development, if .env not in git)
 * 3. Environment variables (Docker, CI/CD, or .env during local setup)
 *
 * The loadSecrets() function is called during initialization to populate
 * process.env from the secrets manager before validation.
 */

const base64Bytes = (bytes: number, label: string) =>
  z.string().refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length >= bytes;
      } catch {
        return false;
      }
    },
    { message: `${label} must be at least ${bytes} bytes of base64 (openssl rand -base64 ${bytes})` },
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: base64Bytes(32, 'SESSION_SECRET'),
  ENCRYPTION_KEY: base64Bytes(32, 'ENCRYPTION_KEY').refine(
    (v) => Buffer.from(v, 'base64').length === 32,
    { message: 'ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256)' },
  ),

  MT5_PROVIDER: z.enum(['mock', 'metaapi']).default('mock'),
  METAAPI_TOKEN: z.string().optional().default(''),
  METAAPI_REGION: z.string().optional().default('new-york'),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('TRi <no-reply@example.com>'),

  FX_API_URL: z.string().url().default('https://api.frankfurter.app'),

  /**
   * Market data for long-term positions. `mock` is the default so a checkout with no vendor
   * account still runs — including the end-to-end suite, which must never reach a network.
   */
  QUOTES_PROVIDER: z.enum(['mock', 'twelvedata']).default('mock'),
  TWELVEDATA_API_KEY: z.string().optional().default(''),
  /**
   * Credits the refresh may spend per day, against the vendor's own daily allowance (800 on
   * the free plan). The margin is deliberate: symbol search and a user pressing "refresh now"
   * come out of the same budget, and running the *vendor's* limit dry returns errors for
   * everything, while running this one dry only postpones a price to tomorrow.
   */
  QUOTES_DAILY_BUDGET: z.coerce.number().int().positive().default(700),

  APP_BASE_DOMAIN: z.string().default('localhost:3000'),
  APP_PROTOCOL: z.enum(['http', 'https']).default('http'),
});

export type Env = z.infer<typeof schema>;

async function load(): Promise<Env> {
  // Load secrets from AWS Secrets Manager, .env.local, or environment variables
  // This populates process.env with values from the secrets manager
  const secrets = await loadSecrets();

  // Merge loaded secrets into process.env for validation
  Object.entries(secrets).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });

  return parseEnv();
}

/** Validates whatever is on `process.env` right now. No I/O, so `env()` can call it too. */
function parseEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nSee .env.example.`);
  }
  if (parsed.data.MT5_PROVIDER === 'metaapi' && !parsed.data.METAAPI_TOKEN) {
    throw new Error('MT5_PROVIDER=metaapi requires METAAPI_TOKEN to be set.');
  }
  if (parsed.data.QUOTES_PROVIDER === 'twelvedata' && !parsed.data.TWELVEDATA_API_KEY) {
    throw new Error('QUOTES_PROVIDER=twelvedata requires TWELVEDATA_API_KEY to be set.');
  }
  return parsed.data;
}

let cached: Env | null = null;
let loadPromise: Promise<Env> | null = null;
let initError: Error | null = null;

export function env(): Env {
  if (initError) {
    throw initError;
  }

  if (cached) {
    return cached;
  }

  /*
   * Not initialised *in this module instance* — which is the normal case, not an error.
   *
   * `instrumentation.ts` is compiled into its own bundle, so the copy of this module that
   * `register()` touches is a different one from the copy a route renders against: `cached`
   * is set over there and null over here. Throwing here 500ed every page behind the login
   * wall while the startup log cheerfully said the environment had been initialised.
   *
   * Re-reading is safe and cheap. `load()` merges whatever the secrets manager returned into
   * `process.env`, and `process.env` *is* shared across bundles — so by the time any request
   * is served, parsing it again yields exactly what `initializeEnv()` computed. The async
   * path still owns fetching; this owns nothing but validation.
   */
  cached = parseEnv();
  return cached;
}

/**
 * Initialize environment asynchronously during app startup.
 * This must be called once during application initialization.
 * Call from: instrumentation-node.ts startMaintenanceSweep() function
 *
 * Returns the initialized environment. Safe to call multiple times (returns cached value).
 */
export async function initializeEnv(): Promise<Env> {
  if (cached) {
    return cached;
  }

  if (!loadPromise) {
    loadPromise = load();
  }

  try {
    cached = await loadPromise;
    console.warn('[Env] Environment initialized and validated');
    return cached;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    initError = error instanceof Error ? error : new Error(message);
    console.error(`[Env] Fatal error during initialization: ${message}`);
    throw initError;
  }
}
