const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pidFile = path.resolve(__dirname, '.next-server.pid');

module.exports = async () => {
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
