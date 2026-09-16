import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: true,
  retries: 0,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
