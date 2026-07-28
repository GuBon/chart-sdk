const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const adminDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(adminDir, '..');
const stateFile = path.resolve(__dirname, '.runtime.json');

function commandFailed(label, result) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? 'unknown'})`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    windowsHide: true,
  });
  commandFailed(`${command} ${args.join(' ')}`, result);
}

function dockerCompose(args, allowFailure = false) {
  const result = spawnSync('docker', ['compose', '--profile', 'real-e2e', ...args], {
    cwd: rootDir,
    stdio: allowFailure ? 'ignore' : 'inherit',
    windowsHide: true,
  });
  if (!allowFailure) commandFailed(`docker compose ${args.join(' ')}`, result);
}

function stopProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already stopped */
    }
  }
}

function readState() {
  if (!fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state));
}

function cleanup() {
  const state = readState();
  stopProcess(state.adminPid);
  stopProcess(state.serverPid);
  fs.rmSync(stateFile, { force: true });
  dockerCompose(['rm', '-s', '-f', 'e2e-db'], true);
}

function isReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode != null && response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function assertPortFree(url, label) {
  if (await isReady(url)) throw new Error(`${label} is already in use: ${url}`);
}

async function waitReady(url, label, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}: ${url}`);
}

module.exports = {
  adminDir,
  rootDir,
  stateFile,
  assertPortFree,
  cleanup,
  dockerCompose,
  waitReady,
  writeState,
};
