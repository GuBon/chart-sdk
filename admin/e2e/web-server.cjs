const { spawn, spawnSync } = require('child_process');
const path = require('path');

const adminDir = path.resolve(__dirname, '..');
const nextBin = path.resolve(adminDir, '..', 'node_modules', 'next', 'dist', 'bin', 'next');

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3100'], {
  cwd: adminDir,
  stdio: 'inherit',
  windowsHide: true,
});

let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
