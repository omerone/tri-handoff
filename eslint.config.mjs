import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // TENANT ISOLATION GUARD.
    //
    // Every database access must go through the repositories in src/lib/db, which take an
    // explicit TenantContext and scope every query by it. Importing the Prisma client
    // anywhere else makes an unscoped query possible, so it is a lint error.
    //
    // `patterns`, not `paths`: an exact-specifier rule misses the spellings a developer is
    // most likely to reach for — a relative '../lib/db/prisma', or the '.prisma/client' and
    // '@prisma/client/default' entry points, which resolve to the same generated client.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@prisma/client',
                '@prisma/client/*',
                '.prisma/client',
                '.prisma/client/*',
                '**/lib/db/prisma',
                '**/db/prisma',
                './prisma',
              ],
              message:
                'Do not import Prisma directly. Use a repository from @/lib/db, which enforces tenant scoping.',
            },
          ],
        },
      ],
      // `no-restricted-imports` only sees static imports; a dynamic import is the obvious
      // way around it.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression > Literal[value=/prisma/i]',
          message:
            'Do not import Prisma directly. Use a repository from @/lib/db, which enforces tenant scoping.',
        },
      ],
    },
  },
  {
    // UNSCOPED-ACCESS GUARD.
    //
    // @/lib/db/unscoped holds the primitives that operate without a TenantContext —
    // host lookup, login, reset redemption, operator tooling. They exist because identity
    // has to be established before it can be scoped, but `setPasswordHash(userId, …)` in
    // the wrong place is a cross-tenant account takeover. Only the modules that establish
    // identity, and the operator panel, may import it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/lib/db/**',
      'src/lib/auth/**',
      'src/lib/tenant/**',
      'src/app/(auth)/**',
      'src/app/admin/**',
      'src/app/api/tls/**',
      'src/instrumentation.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/db/unscoped', '**/db/unscoped'],
              message:
                'Unscoped queries are restricted to the modules that establish identity (src/lib/auth, src/lib/tenant, src/app/(auth)) and the operator panel. Use @/lib/db, whose exports require a TenantContext.',
            },
            {
              group: [
                '@prisma/client',
                '@prisma/client/*',
                '.prisma/client',
                '.prisma/client/*',
                '**/lib/db/prisma',
                '**/db/prisma',
              ],
              message:
                'Do not import Prisma directly. Use a repository from @/lib/db, which enforces tenant scoping.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts', 'prisma/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
