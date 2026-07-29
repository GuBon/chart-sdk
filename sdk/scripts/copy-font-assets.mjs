import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDir = resolve(sdkDir, '..');
const assetContract = await readFile(resolve(workspaceDir, 'chart-options', 'assets.ts'), 'utf8');
const fontAssetVersion = assetContract.match(
  /CHART_STATIC_ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/,
)?.[1];
if (!fontAssetVersion) {
  throw new Error('chart-options/assets.ts에서 CHART_STATIC_ASSET_VERSION을 읽지 못했습니다.');
}
const fontRootDir = resolve(sdkDir, 'dist', 'fonts');
const outputDir = resolve(fontRootDir, fontAssetVersion);
const pretendardOutputDir = resolve(outputDir, 'pretendard');
const notoOutputDir = resolve(outputDir, 'noto-sans-kr');
const licenseOutputDir = resolve(outputDir, 'licenses');

const pretendardDir = resolve(workspaceDir, 'node_modules', 'pretendard');
const notoDir = resolve(workspaceDir, 'node_modules', '@fontsource-variable', 'noto-sans-kr');

await rm(fontRootDir, { recursive: true, force: true });
await Promise.all([
  mkdir(pretendardOutputDir, { recursive: true }),
  mkdir(notoOutputDir, { recursive: true }),
  mkdir(licenseOutputDir, { recursive: true }),
]);

await Promise.all([
  copyFile(
    resolve(pretendardDir, 'dist', 'LICENSE.txt'),
    resolve(licenseOutputDir, 'pretendard-OFL.txt'),
  ),
  copyFile(
    resolve(notoDir, 'LICENSE'),
    resolve(licenseOutputDir, 'noto-sans-kr-OFL.txt'),
  ),
]);

const pretendardFilesDir = resolve(
  pretendardDir,
  'dist',
  'web',
  'variable',
  'woff2-dynamic-subset',
);
const pretendardFiles = (await readdir(pretendardFilesDir)).filter((name) => name.endsWith('.woff2'));
await Promise.all(pretendardFiles.map((name) =>
  copyFile(resolve(pretendardFilesDir, name), resolve(pretendardOutputDir, name))));

const notoFilesDir = resolve(notoDir, 'files');
const notoFiles = (await readdir(notoFilesDir)).filter((name) => name.endsWith('.woff2'));
await Promise.all(notoFiles.map((name) =>
  copyFile(resolve(notoFilesDir, name), resolve(notoOutputDir, name))));

const notoCss = (await readFile(resolve(notoDir, 'index.css'), 'utf8'))
  .replaceAll("'Noto Sans KR Variable'", "'ChartSDK Noto Sans KR'")
  .replaceAll('./files/', './noto-sans-kr/');

const pretendardCss = (await readFile(
  resolve(pretendardDir, 'dist', 'web', 'variable', 'pretendardvariable-dynamic-subset.css'),
  'utf8',
))
  .replaceAll("'Pretendard Variable'", "'ChartSDK Pretendard'")
  .replaceAll('./woff2-dynamic-subset/', './pretendard/');

const css = `/*
 * ChartSDK bundled webfonts
 * Pretendard 1.3.9 and Noto Sans KR v39 are distributed under the SIL Open Font License 1.1.
 * License copies are available in ./licenses/.
 */
${pretendardCss}
${notoCss}`;

await writeFile(resolve(outputDir, 'chartsdk-fonts.css'), css, 'utf8');

console.log(`ChartSDK webfont assets copied (${pretendardFiles.length + notoFiles.length} WOFF2 files).`);
