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
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
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
        FORGE_DB_PATH: resolve(here, 'e2e/.tmp/onboarding-ui.db'),
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
