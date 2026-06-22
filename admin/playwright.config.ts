import { defineConfig, devices } from '@playwright/test';

// E2E — dev 서버(포트 3100)를 띄우고 실제 브라우저로 화면을 검증한다.
// MSW 가 /api/v1 을 가로채므로 server 없이 전 화면 동작 확인 가능.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx next dev -p 3100',
    port: 3100,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
