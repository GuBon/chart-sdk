/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // chart-options 는 TS 소스 패키지(SSOT) — 직접 트랜스파일
  transpilePackages: ['@chartsdk/chart-options'],
  // E2E dev 서버(:3100)가 개발 서버(:3000)와 같은 .next 를 공유하면 서로의 산출물을
  // 덮어써 ENOENT 손상 발생(트러블슈팅 L14) → E2E 는 NEXT_DIST_DIR=.next-e2e 로 격리.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
