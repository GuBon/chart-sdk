const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const pidFile = path.resolve(__dirname, '.next-server.pid');
const port = 3100;

// dev 서버는 라우트를 최초 요청 시점에 컴파일한다(콜드 기준 라우트당 1~7초, 첫 라우트 ~25초).
// 테스트가 그 비용을 지불하면 30초 timeout 을 잠식하고 병렬 worker 간 컴파일 경합이 생기므로
// 대표 라우트를 setup 단계에서 한 번에 병렬로 예열한다(콜드 전체 ~20초, 이미 컴파일된 서버는 수백 ms).
const WARMUP_ROUTES = [
  '/',
  '/charts/new',
  '/charts/analytics-db/public/sales/1',
  '/datasources',
  '/charts/analytics-db?view=schema',
  '/charts/analytics-db/public',
  '/charts/analytics-db/public/sales',
  '/login',
  '/signup',
  '/admin/users',
  '/admin/users/1',
  '/admin/charts',
  '/admin/charts/1',
];
const WARMUP_TIMEOUT_MS = 90_000;

function fetchStatus(pathname, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}${pathname}`, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', () => resolve(0));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function isReady() {
  // public/ 정적 파일은 컴파일 없이 응답하므로 기동 감지가 라우트 컴파일에 가려지지 않는다.
  return (await fetchStatus('/mockServiceWorker.js', 1000)) === 200;
}

async function waitReady() {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for http://localhost:${port}`);
}

async function warmUpRoutes() {
  const started = Date.now();
  const statuses = await Promise.all(
    WARMUP_ROUTES.map(async (route) => [route, await fetchStatus(route, WARMUP_TIMEOUT_MS)]),
  );
  const failed = statuses.filter(([, status]) => status !== 200);
  if (failed.length > 0) {
    throw new Error(`E2E dev server warm-up failed: ${failed.map(([route, status]) => `${route} → ${status || 'timeout'}`).join(', ')}`);
  }
  console.log(`[e2e] warmed ${WARMUP_ROUTES.length} routes in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

module.exports = async () => {
  // `npx playwright test`처럼 npm lifecycle을 우회해도 실제 복사 스니펫이 참조할 /sdk.js를 보장한다.
  const adminDir = path.resolve(__dirname, '..');
  const npmCli = process.platform === 'win32'
    ? path.resolve(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null;
  const prepared = spawnSync(npmCli ? process.execPath : 'npm', [...(npmCli ? [npmCli] : []), 'run', 'prepare:sdk-public'], {
    cwd: adminDir,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (prepared.status !== 0) {
    throw new Error(`Failed to prepare /sdk.js (exit ${prepared.status ?? 'unknown'})`);
  }

  if (await isReady()) {
    // 이미 떠 있는 서버(개발자가 유지 중)는 재사용하고 teardown 에서 종료하지 않는다.
    fs.writeFileSync(pidFile, '');
  } else {
    const child = spawn(process.execPath, [path.resolve(__dirname, 'web-server.cjs')], {
      cwd: path.resolve(__dirname, '..'),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    fs.writeFileSync(pidFile, String(child.pid));
    await waitReady();
  }
  await warmUpRoutes();
};
