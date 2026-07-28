import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './real-e2e',
  globalSetup: './real-e2e/global-setup.cjs',
  globalTeardown: './real-e2e/global-teardown.cjs',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/real-e2e',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-real-backend', use: { ...devices['Desktop Chrome'] } }],
});
