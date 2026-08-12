const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pidFile = path.resolve(__dirname, '.next-server.pid');
const nextEnvFile = path.resolve(__dirname, '..', 'next-env.d.ts');

function restoreCanonicalNextEnv() {
  // Next dev rewrites this generated declaration to NEXT_DIST_DIR(.next-e2e).
  // E2E 산출 경로가 추적 파일에 남아 일반 typecheck/빌드를 오염시키지 않도록 원래 경로로 되돌린다.
  fs.writeFileSync(nextEnvFile, [
    '/// <reference types="next" />',
    '/// <reference types="next/image-types/global" />',
    '/// <reference path="./.next/types/routes.d.ts" />',
    '',
    '// NOTE: This file should not be edited',
    '// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.',
    '',
  ].join('\n'));
}

module.exports = async () => {
  restoreCanonicalNextEnv();
  if (!fs.existsSync(pidFile)) return;
  const pid = fs.readFileSync(pidFile, 'utf8').trim();
  fs.rmSync(pidFile, { force: true });
  if (!pid) return;

  if (process.platform === 'win32') {
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      /* already stopped */
    }
  }
};
