import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chartFontStylesheetUrl,
  ensureChartWebFonts,
} from '@chartsdk/chart-options/webFonts';

beforeEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
});

function captureStylesheetLink(): () => HTMLLinkElement | null {
  let appended: HTMLLinkElement | null = null;
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    appended = nodes[0] instanceof HTMLLinkElement ? nodes[0] : null;
  });
  return () => appended;
}

describe('ChartSDK webfonts', () => {
  it('SDK script 디렉터리를 기준으로 글꼴 CSS URL을 만든다', () => {
    expect(chartFontStylesheetUrl('https://cdn.example.com/charts/'))
      .toBe('https://cdn.example.com/charts/fonts/v1/chartsdk-fonts.css');
  });

  it('기본 글꼴 차트는 웹폰트 자산을 요청하지 않는다', async () => {
    await ensureChartWebFonts(
      { title: { text: '기본 차트' } },
      'https://assets-default.example.com/',
      document,
    );
    expect(document.querySelector('link[data-chartsdk-fonts]')).toBeNull();
  });

  it('Pretendard CSS와 현재 차트 문자열의 글리프를 setOption 전에 불러온다', async () => {
    const stylesheetLink = captureStylesheetLink();
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });

    const ready = ensureChartWebFonts(
      {
        title: {
          text: '월별 매출',
          textStyle: { fontFamily: "'ChartSDK Pretendard',sans-serif" },
        },
      },
      'https://assets-pretendard.example.com/sdk/',
      document,
    );
    const link = stylesheetLink();
    expect(link?.href).toBe('https://assets-pretendard.example.com/sdk/fonts/v1/chartsdk-fonts.css');
    link?.dispatchEvent(new Event('load'));
    await ready;

    expect(load).toHaveBeenCalledOnce();
    expect(load.mock.calls[0][0]).toBe('12px "ChartSDK Pretendard"');
    expect(load.mock.calls[0][1]).toContain('매출');
  });

  it('Noto Sans KR 선택은 전용 폰트 패밀리를 불러온다', async () => {
    const stylesheetLink = captureStylesheetLink();
    const load = vi.fn().mockResolvedValue([]);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });

    const ready = ensureChartWebFonts(
      {
        xAxis: {
          data: ['서울', '부산'],
          axisLabel: { fontFamily: "'ChartSDK Noto Sans KR',sans-serif" },
        },
      },
      'https://assets-noto.example.com/',
      document,
    );
    stylesheetLink()?.dispatchEvent(new Event('load'));
    await ready;

    expect(load).toHaveBeenCalledWith(
      '12px "ChartSDK Noto Sans KR"',
      expect.stringContaining('서울부산'),
    );
  });
});
