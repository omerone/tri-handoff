import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output is what the Docker image ships; `next start` warns about it, so it is
  // opt-in via NEXT_OUTPUT (set in the Dockerfile) and off for local runs and e2e.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  serverExternalPackages: ['@node-rs/argon2', 'nodemailer'],
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
    ];
  },
};

export default withNextIntl(nextConfig);
