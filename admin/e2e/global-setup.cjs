const { spawn } = require('child_process');
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
