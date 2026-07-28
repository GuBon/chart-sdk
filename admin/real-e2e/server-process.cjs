const { spawn, spawnSync } = require('child_process');
const path = require('path');

const serverDir = path.resolve(__dirname, '..', '..', 'server');
const gradle = path.resolve(serverDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const child = spawn(gradle, ['bootRun', '--no-daemon'], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: '8082',
    DATABASE_URL: 'jdbc:postgresql://localhost:56432/chartsdk_e2e',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: 'chartsdk-e2e',
    DATASOURCE_ENC_KEY: 'chartsdk-real-e2e-datasource-key',
    CHARTSDK_EMBED_JWT_SECRET: 'chartsdk-real-e2e-embed-secret',
  },
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (process.platform === 'win32') {
    spawnSync('C:\\Windows\\System32\\taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
child.on('exit', (code) => process.exit(code ?? 0));
