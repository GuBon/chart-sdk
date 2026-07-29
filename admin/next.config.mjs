import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminDir = dirname(fileURLToPath(import.meta.url));
const assetContract = readFileSync(resolve(adminDir, '..', 'chart-options', 'assets.ts'), 'utf8');
const assetVersion = assetContract.match(
  /CHART_STATIC_ASSET_VERSION\s*=\s*['"]([^'"]+)['"]/,
)?.[1];
if (!assetVersion) throw new Error('CHART_STATIC_ASSET_VERSION을 읽지 못했습니다.');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // chart-options 는 TS 소스 패키지(SSOT) — 직접 트랜스파일
  transpilePackages: ['@chartsdk/chart-options'],
  // E2E dev 서버(:3100)가 개발 서버(:3000)와 같은 .next 를 공유하면 서로의 산출물을
  // 덮어써 ENOENT 손상 발생(트러블슈팅 L14) → E2E 는 NEXT_DIST_DIR=.next-e2e 로 격리.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [
      {
        // 버전 경로로 URL이 바뀌므로 장기 immutable이 안전하다.
        source: `/fonts/${assetVersion}/:path*`,
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // sdk.js는 고정 파일명이므로 매 배포 시 재검증한다.
        source: '/sdk.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
