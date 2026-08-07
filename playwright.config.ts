import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://demo.localhost:${PORT}`;

const STORAGE_STATE = 'e2e/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Signs in once and saves the session — see e2e/auth.setup.ts for why.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    // The smoke suite exercises the login wall itself, so it starts signed out.
    {
      name: 'smoke-desktop',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Pixel 7 rather than an iPhone so the suite needs only the Chromium download; the
      // point here is the 412px viewport, not the engine.
      name: 'smoke-mobile',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },

    // Everything behind the login wall reuses the one session.
    {
      name: 'app-desktop',
      testIgnore: [/smoke\.spec\.ts/, /auth\.setup\.ts/],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
    {
      name: 'app-mobile',
      testIgnore: [/smoke\.spec\.ts/, /auth\.setup\.ts/],
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    /*
     * The suite is production and mock on purpose, which the boot guard otherwise refuses.
     *
     * `next start` is a production build by definition and the whole point of these tests is
     * to drive one against the mock broker. `src/lib/env.ts` refuses that pairing, correctly —
     * a deploy that forgot `MT5_PROVIDER` would otherwise serve invented trades — so the one
     * caller that means it says so here. Nothing on the server sets this.
     */
    env: { ...process.env, E2E_ALLOW_MOCK: '1' },
    url: `http://localhost:${PORT}/healthz`,
    // Never reuse. A server left running from an earlier build answers /healthz perfectly
    // well and then serves stale code — the suite hangs on elements that exist in the source
    // but not in what is being served, which is a long way to travel to debug. Rebuilding
    // costs about forty seconds and removes the whole class of confusion.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
