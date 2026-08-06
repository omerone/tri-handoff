import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** See `src/lib/secrets/manager.edge.ts` — the Edge build cannot compile the real one. */
const EDGE_SECRETS_STUB = fileURLToPath(
  new URL('./src/lib/secrets/manager.edge.ts', import.meta.url),
);
/** Likewise `src/lib/mail/mailer.edge.ts`: nodemailer's DKIM signer needs `path` and `fs`. */
const EDGE_MAILER_STUB = fileURLToPath(new URL('./src/lib/mail/mailer.edge.ts', import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is what the Docker image ships; `next start` warns about it, so it is
  // opt-in via NEXT_OUTPUT (set in the Dockerfile) and off for local runs and e2e.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  experimental: {
    /**
     * How long a visited tab stays in the client's router cache.
     *
     * Every page behind the login wall is `force-dynamic` (see `(app)/layout.tsx`), and Next
     * 15 caches dynamic routes for zero seconds by default. The nav already prefetches all
     * seven tabs — so the app was paying for a full server render of each one and then
     * throwing the result away, re-fetching from scratch on the click that followed.
     * Measured on this app: 21 tab switches cost 21 server renders and 4MB before, 7 renders
     * and 1.6MB after, and a tab visited in the last half-minute now opens with no request at
     * all — 25-80ms instead of 84-598ms.
     *
     * Thirty seconds is safe here because nothing changes the numbers without saying so:
     * every server action calls `revalidatePath`, and the MT5 sync — the one thing that
     * brings in data the user did not type — calls `revalidatePath('/', 'layout')` and
     * `router.refresh()`, which drop this cache entirely. The exposure is data changed by
     * something outside this browser, which is worth at most half a minute of staleness.
     */
    staleTimes: { dynamic: 30 },
  },
  // `dotenv` and the AWS SDK reach `@/lib/secrets/manager` through `env.ts`, which
  // `instrumentation.ts` pulls in — and Next compiles that file for the Edge runtime too,
  // where `require('path')` does not resolve. Left to the bundler it is a hard build error on
  // every page. These are Node-only by nature, so they are handed to the runtime, not bundled.
  serverExternalPackages: [
    '@node-rs/argon2',
    'nodemailer',
    'dotenv',
    '@aws-sdk/client-secrets-manager',
  ],
  /**
   * …and the same modules again, for the Edge build, which `serverExternalPackages` does not
   * cover: it applies to the Node server bundle only, so the Edge compilation of
   * `instrumentation.ts` still followed `env.ts` into the secrets manager and failed on
   * `Can't resolve 'os'`. Swapping in the stub is safe because no Edge code path reaches it —
   * `middleware.ts` is the only thing that runs there and it imports one pure helper.
   */
  webpack: (config, { nextRuntime, webpack }) => {
    if (nextRuntime === 'edge') {
      // A `resolve.alias` entry is not enough: Next already aliases `@` to `src/`, and that
      // prefix wins the match. Replacing the module after it resolves is unambiguous.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]lib[\\/]secrets[\\/]manager(\.ts)?$/,
          EDGE_SECRETS_STUB,
        ),
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]lib[\\/]mail[\\/]mailer(\.ts)?$/,
          EDGE_MAILER_STUB,
        ),
      );
    }
    return config;
  },
  eslint: {
    // Linting is a separate step in `npm run check`; don't run it twice during build.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Content-Security-Policy is set per-request in src/middleware.ts, because
          // script-src carries a fresh nonce on every response.
        ],
      },
      {
        source: '/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
