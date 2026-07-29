import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDir = join(root, '.tmp_transform');

function childEnvironment() {
  const environment = {};
  const actualKeys = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toLowerCase();
    const previous = actualKeys.get(normalized);
    if (previous) delete environment[previous];
    actualKeys.set(normalized, key);
    environment[key] = value;
  }
  return environment;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: childEnvironment(),
  });
  if (result.status === 0) return;
  rmSync(snapshotDir, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

rmSync(snapshotDir, { recursive: true, force: true });
run(
  process.execPath,
  [
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'lib/transformParityAudit.test.ts',
  ],
  join(root, 'admin'),
);
const gradleArgs = [
  'test',
  '--tests',
  'com.chartsdk.converter.TransformParityAuditTest',
  '--rerun-tasks',
  '--no-daemon',
];
if (process.platform === 'win32') {
  run(
    process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
    ['/d', '/s', '/c', `call gradlew.bat ${gradleArgs.join(' ')}`],
    join(root, 'server'),
  );
} else {
  run('./gradlew', gradleArgs, join(root, 'server'));
}

const mock = JSON.parse(readFileSync(join(snapshotDir, 'mock.json'), 'utf8'));
const java = JSON.parse(readFileSync(join(snapshotDir, 'java.json'), 'utf8'));
const differences = [];

function compare(left, right, path) {
  if (Object.is(left, right)) return;
  const leftScalar = left === null || typeof left !== 'object';
  const rightScalar = right === null || typeof right !== 'object';
  if (leftScalar || rightScalar || Array.isArray(left) !== Array.isArray(right)) {
    differences.push({ path, mock: left, java: right });
    return;
  }
  if (Array.isArray(left)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      compare(left[index], right[index], `${path}.${index}`);
    }
    return;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    if (!(key in left)) {
      differences.push({ path: `${path}.${key}`, mock: '<absent>', java: right[key] });
    } else if (!(key in right)) {
      differences.push({ path: `${path}.${key}`, mock: left[key], java: '<absent>' });
    } else {
      compare(left[key], right[key], path ? `${path}.${key}` : key);
    }
  }
}

compare(mock, java, '');
if (differences.length > 0) {
  console.error(`Chart transform parity failed: ${differences.length} difference(s).`);
  for (const difference of differences.slice(0, 100)) {
    console.error(JSON.stringify(difference));
  }
} else {
  console.log(
    `Chart transform parity verified: ${Object.keys(mock.defaults).length} defaults, `
      + `${Object.keys(mock.configured).length} configured cases.`,
  );
}

rmSync(snapshotDir, { recursive: true, force: true });
if (differences.length > 0) process.exit(1);
