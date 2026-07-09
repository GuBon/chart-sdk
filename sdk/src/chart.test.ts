import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// echarts 는 mock — 실픽셀(canvas) 렌더는 라이브 스위프가 담당. 여기선 SDK 자체 DOM 로직만 검증.
const ec = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { instance, init: vi.fn(() => instance) };
});
vi.mock('echarts/core', () => ({ use: vi.fn(), init: ec.init }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {}, ScatterChart: {} }));
vi.mock('echarts/components', () => ({ GridComponent: {}, TooltipComponent: {}, LegendComponent: {}, TitleComponent: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import { renderChart, renderError } from './chart';

const roDisconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  // ResizeObserver 를 결정적 stub 으로(happy-dom 유무 무관).
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() { roDisconnect(); } });
});
afterEach(() => vi.unstubAllGlobals());

describe('renderChart', () => {
  it('host div 를 만들고 echarts.init·setOption 을 호출한다', () => {
    const el = document.createElement('div');
    const option = { series: [{ type: 'bar' }] };
    renderChart(el, option);
    expect(ec.init).toHaveBeenCalledOnce();
    expect(ec.instance.setOption).toHaveBeenCalledWith(option);
    expect(el.querySelector('div')).not.toBeNull(); // host 컨테이너
  });

  it('computedAt 가 있으면 "데이터 기준" 캡션을 붙인다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, '2026-07-06T12:00:00Z');
    const cap = el.querySelector('[data-chart-caption]');
    expect(cap?.textContent).toMatch(/데이터 기준 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('computedAt 가 없으면 캡션이 없다', () => {
    const el = document.createElement('div');
    renderChart(el, {});
    expect(el.querySelector('[data-chart-caption]')).toBeNull();
  });

  it('반환된 cleanup 은 dispose·observer disconnect·컨테이너 비움을 수행한다', () => {
    const el = document.createElement('div');
    const cleanup = renderChart(el, {});
    cleanup();
    expect(ec.instance.dispose).toHaveBeenCalledOnce();
    expect(roDisconnect).toHaveBeenCalledOnce();
    expect(el.innerHTML).toBe('');
  });
});

describe('renderError', () => {
  it('data-chart-error 속성과 기본 메시지를 표시한다', () => {
    const el = document.createElement('div');
    renderError(el);
    expect(el.hasAttribute('data-chart-error')).toBe(true);
    expect(el.textContent).toBe('차트를 표시할 수 없습니다');
  });

  it('커스텀 메시지를 표시한다', () => {
    const el = document.createElement('div');
    renderError(el, '토큰 만료');
    expect(el.textContent).toBe('토큰 만료');
  });
});
