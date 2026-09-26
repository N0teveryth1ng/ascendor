import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_PORT = Number(process.env.WEB_PORT ?? 5193);
const API_PORT = Number(process.env.API_PORT ?? 5194);

/**
 * The UI test runs against a throwaway API on a throwaway database so it can
 * assert on a genuinely fresh account with no PCP on file, every run.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  /*
   * These specs drive the real API against a real (often remote) Postgres, where
   * a single round-trip costs one network RTT. Measured from a machine in India
   * to a Neon us-east-2 endpoint, one RTT is ~270ms, so a page that fires the
   * signup, profile and onboarding calls in sequence legitimately takes several
   * seconds. Playwright's 5s default is not a safe floor for that, and failing
   * on it would be a flaky test rather than a real defect. The timeout is set
   * for the slow path on purpose; a genuinely broken flow still fails fast
   * because assertions on a missing element do not wait out the clock.
   */
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/src/index.js',
      cwd: resolve(here, '../server'),
      url: `http://127.0.0.1:${API_PORT}/api/meta`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        // DATABASE_URL passes through from the shell. Point it at a dedicated
        // throwaway database: this suite signs up real accounts, and the smoke
        // suite truncates its own target outright. Demo seeding stays off so the
        // spec always gets a genuinely fresh account with no PCP on file.
      },
    },
    {
      command: 'npm run dev',
      cwd: here,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        WEB_PORT: String(WEB_PORT),
        FORGE_API: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
