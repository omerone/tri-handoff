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
    // Every database access must go through the repositories in src/lib/db, which require an
    // explicit TenantContext and scope every query by tenant. Importing the Prisma client
    // anywhere else makes it possible to write an unscoped query, so it is a lint error.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'Do not import Prisma directly. Use a repository from @/lib/db, which enforces tenant scoping.',
            },
            {
              name: '@/lib/db/prisma',
              message:
                'Do not import the raw Prisma client. Use a repository from @/lib/db, which enforces tenant scoping.',
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
