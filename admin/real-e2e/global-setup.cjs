const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');

module.exports = async () => {
  runtime.cleanup();
  await runtime.assertPortFree('http://localhost:8082/actuator/health', 'real E2E Spring port');
  await runtime.assertPortFree('http://localhost:3001', 'real E2E Admin port');

  const outputDir = path.resolve(runtime.adminDir, 'test-results', 'real-e2e');
  fs.mkdirSync(outputDir, { recursive: true });
  const state = {};

  try {
    if (!fs.existsSync(path.resolve(runtime.adminDir, 'public', 'sdk.js'))) {
      throw new Error('admin/public/sdk.js is missing. Run npm run prepare:sdk-public before the real E2E suite.');
    }
    runtime.dockerCompose(['up', '-d', '--force-recreate', '--wait', 'e2e-db']);

    const serverLog = fs.openSync(path.resolve(outputDir, 'spring.log'), 'a');
    const server = spawn(process.execPath, [path.resolve(__dirname, 'server-process.cjs')], {
      cwd: runtime.rootDir,
      detached: true,
      stdio: ['ignore', serverLog, serverLog],
      windowsHide: true,
    });
    server.unref();
    fs.closeSync(serverLog);
    state.serverPid = server.pid;
    runtime.writeState(state);
    await runtime.waitReady('http://localhost:8082/actuator/health', 'Spring');

    const adminLog = fs.openSync(path.resolve(outputDir, 'admin.log'), 'a');
    const admin = spawn(process.execPath, [path.resolve(__dirname, 'web-process.cjs')], {
      cwd: runtime.adminDir,
      detached: true,
      stdio: ['ignore', adminLog, adminLog],
      windowsHide: true,
    });
    admin.unref();
    fs.closeSync(adminLog);
    state.adminPid = admin.pid;
    runtime.writeState(state);
    await runtime.waitReady('http://localhost:3001', 'Admin');
  } catch (error) {
    runtime.cleanup();
    throw error;
  }
};
