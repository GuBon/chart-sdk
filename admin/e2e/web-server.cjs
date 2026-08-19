const { spawn, spawnSync } = require('child_process');
const path = require('path');

const adminDir = path.resolve(__dirname, '..');
const nextBin = path.resolve(adminDir, '..', 'node_modules', 'next', 'dist', 'bin', 'next');

const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3100'], {
  cwd: adminDir,
  env: {
    ...process.env,
    NEXT_PUBLIC_E2E_MSW: 'true',
    // 개발 서버(:3000)의 .next 와 분리 — 동시 구동 시 빌드 산출물 상호 덮어쓰기(ENOENT) 방지. L14.
    NEXT_DIST_DIR: '.next-e2e',
  },
  stdio: 'inherit',
  windowsHide: true,
});

let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  if (process.platform === 'win32') {
    // PATH 에 System32 가 없는 셸(제한된 CI/에이전트 환경)에서도 동작하도록 절대 경로를 쓴다.
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
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
