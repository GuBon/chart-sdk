import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDist = resolve(adminDir, '..', 'sdk', 'dist');
const publicDir = resolve(adminDir, 'public');
const assets = ['sdk.js', 'sdk.js.map'];

await mkdir(publicDir, { recursive: true });

for (const asset of assets) {
  const source = resolve(sdkDist, asset);
  const target = resolve(publicDir, asset);
  try {
    await copyFile(source, target);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`SDK 산출물이 없습니다: ${source}. 먼저 SDK를 빌드해야 합니다.`, { cause: error });
    }
    throw error;
  }
}

console.log('SDK embed assets copied to admin/public.');
