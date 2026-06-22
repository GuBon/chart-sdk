import type { Config } from 'tailwindcss';

// 디자인 토큰 — Figma 실제 변수 기준(shadcn neutral 팔레트, get_variable_defs 실측).
// 메모리/화면설계서 토큰표(#0D0D0D 등)보다 파일의 실제 변수를 우선한다.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#171717', // Figma var(--primary): 검정 버튼·활성
        'primary-foreground': '#fafafa', // var(--primary-foreground)
        chart: '#5470C6', // ECharts 기본 차트색
        success: '#1D9E75',
        danger: '#D14343',
        info: '#378ADD',
        border: '#e5e5e5', // var(--border)
        muted: '#f5f5f5', // var(--muted): 보조 배경
        'bg-page': '#fafafa', // 본문 배경(S1 실측)
        'bg-panel': '#ffffff', // var(--card)
        'text-primary': '#0a0a0a', // var(--foreground)
        'text-secondary': '#737373', // var(--muted-foreground): 보조 텍스트·placeholder
        'text-tertiary': '#a3a3a3', // neutral-400
      },
      borderRadius: {
        md: '8px', // var(--radius-md)
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
