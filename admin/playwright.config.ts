import { defineConfig, devices } from '@playwright/test';

// E2E — dev 서버(포트 3100)를 띄우고 실제 브라우저로 화면을 검증한다.
// MSW 가 /api/v1 을 가로채므로 server 없이 전 화면 동작 확인 가능.
// MSW 워커·mock 상태는 브라우저 컨텍스트(=테스트) 안에서만 살고 각 테스트가 스스로 goto 하므로
// 파일 안에서도 테스트를 병렬로 흩뿌릴 수 있다. worker 수는 단일 dev 서버가 감당할 범위로 제한한다.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.cjs',
  globalTeardown: './e2e/global-teardown.cjs',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : isCI ? 2 : 4,
  // CI 는 배포 게이트라 1회 재시도로 환경 잡음을 흡수하되, 재시도 통과(flaky)는 리포트에 남는다.
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
