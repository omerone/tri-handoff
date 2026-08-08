import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/*
 * Spread straight in, no `FlatCompat`.
 *
 * These two used to be `.eslintrc` shapes and had to be converted. As of
 * eslint-config-next 16 they are already flat arrays, and putting a flat config
 * through the compatibility layer does not merely waste a step — it throws
 * `Converting circular structure to JSON` and takes the whole lint run with it,
 * including the tenant-isolation guards below, which are the reason this file is
 * interesting.
 */

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      // A design prototype, kept for reference and never built or shipped. It is one
      // 800-line JSX sketch and it accounts for twenty-one of the errors the Next 16
      // rules find; holding a sketch to the app's standards teaches nobody anything.
      'docs/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
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
    // `.mjs` as well as `.ts`: a build script that says what it wrote is the one place
    // `console.log` is the interface rather than a leftover.
    files: ['scripts/**/*.{ts,mjs,js}', 'prisma/**/*.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    /*
     * React Compiler rules, which arrived with eslint-config-next 16 and which this codebase
     * has never been held to.
     *
     * They are kept on and kept visible, at `warn`, rather than deleted. Every one of them
     * names something true — a component declared inside a render function is rebuilt on
     * every render, a ref written during render is a render with a side effect — and all of
     * it is pre-existing, in components covered by the end-to-end suite. Fixing them is a
     * refactor with its own regression risk, and it does not belong inside a version bump
     * taken to close a security advisory. Four sites: `trades/filters.tsx` (a local `Filter`
     * component), `trades/multi-filter.tsx` (a ref assigned during render), and the debounced
     * effects in `long/symbol-field.tsx`, `shell/range-picker.tsx` and
     * `admin/audit-log-viewer.tsx`.
     */
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    /*
     * ...except `immutability`, which is switched off for pages rather than softened.
     *
     * Every page in this app is an async server component — `(app)/layout.tsx` forces it —
     * and the rule fires on `allConverted = false` inside a `Promise.all`, telling us to
     * "consider using state instead". There is no state and no re-render: the function runs
     * once per request, on the server, and the variable is a local. The rule is reasoning
     * about a client render that never happens.
     */
    files: ['src/app/**/page.tsx'],
    rules: {
      'react-hooks/immutability': 'off',
    },
  },
];

export default config;
