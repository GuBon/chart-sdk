/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // chart-options 는 TS 소스 패키지(SSOT) — 직접 트랜스파일
  transpilePackages: ['@chartsdk/chart-options'],
};

export default nextConfig;
