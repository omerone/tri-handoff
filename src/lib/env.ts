import 'server-only';
import { z } from 'zod';

/**
 * Server-side environment. Validated once at first import so a misconfigured
 * deployment fails loudly at boot instead of at the first request that needs a secret.
 *
 * Nothing in this module may ever be imported from a client component — the
 * `server-only` import above turns that into a build error.
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

  APP_BASE_DOMAIN: z.string().default('localhost:3000'),
  APP_PROTOCOL: z.enum(['http', 'https']).default('http'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
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
  return parsed.data;
}

let cached: Env | null = null;

export function env(): Env {
  cached ??= load();
  return cached;
}
