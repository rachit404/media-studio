import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// Locally we drive the installed branded Chrome (real GPU, proprietary codecs). CI installs Playwright's Chromium.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env['CI'] ? undefined : 'chrome' },
    },
  ],
  // Serves the production build (run `pnpm build` first; `pnpm test:e2e` does) with the production security headers.
  webServer: {
    command: 'pnpm --filter @media-studio/web preview',
    cwd: '..',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
