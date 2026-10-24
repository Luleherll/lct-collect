import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  use: {
    locale: 'en-UG',
    timezoneId: 'Africa/Kampala',
    baseURL: 'http://127.0.0.1:4179',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: {
    command:
      'PUBLIC_USE_EMULATORS=true ASTRO_TELEMETRY_DISABLED=1 astro build --outDir .test-dist && ASTRO_TELEMETRY_DISABLED=1 astro preview --outDir .test-dist --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
  },
});
