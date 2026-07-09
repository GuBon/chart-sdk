import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 순수 로직(lib/*) 단위 테스트 — node 환경(DOM 불필요). E2E(Playwright)는 별도(e2e/).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    // tsconfig 의 "@/*" → admin 루트. builder.ts 는 import type 만 쓰므로 api 런타임은 로드되지 않는다.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
