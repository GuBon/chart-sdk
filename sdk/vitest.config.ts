import { defineConfig } from 'vitest/config';

// SDK 단위 테스트 — DOM 부수효과(scan·renderChart)가 있어 happy-dom 환경.
// echarts.init·fetch·ResizeObserver 는 각 테스트에서 mock/stub 한다(실픽셀은 라이브 스위프가 담당).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
