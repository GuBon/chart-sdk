import { defineConfig } from 'tsup';

// 단일 IIFE 번들 (echarts 포함) — <script src="sdk.js"> 한 줄로 임베드
export default defineConfig({
  entry: { sdk: 'src/index.ts' },
  format: ['iife'],
  globalName: 'ChartSDK',
  platform: 'browser',
  outDir: 'dist',
  clean: true,
  minify: true,
  sourcemap: true,
  onSuccess: 'node scripts/copy-font-assets.mjs',
  // IIFE 기본 출력명(sdk.global.js) 대신 임베드 스니펫과 동일한 sdk.js 로
  outExtension: () => ({ js: '.js' }),
});
