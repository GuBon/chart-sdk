const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const pidFile = path.resolve(__dirname, '.next-server.pid');
const port = 3100;

function isReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitReady() {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for http://localhost:${port}`);
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
    fs.writeFileSync(pidFile, '');
    return;
  }

  const child = spawn(process.execPath, [path.resolve(__dirname, 'web-server.cjs')], {
    cwd: path.resolve(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  await waitReady();
};
