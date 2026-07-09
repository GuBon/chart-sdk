import { beforeEach, describe, expect, it, vi } from 'vitest';

// index.ts 는 로드 시 부수효과(apiBase 확정 + 자동 scan)가 있어, 테스트마다 resetModules + 동적 import 로 재평가한다.
// api·chart 는 mock — 네트워크·echarts 를 차단하고 index 의 분기 로직만 검증.
const mocks = vi.hoisted(() => ({
  fetchChartOption: vi.fn(),
  renderChart: vi.fn(),
  renderError: vi.fn(),
}));
vi.mock('./api', () => ({ fetchChartOption: mocks.fetchChartOption }));
vi.mock('./chart', () => ({ renderChart: mocks.renderChart, renderError: mocks.renderError }));

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { CHARTSDK_API_BASE?: string }).CHARTSDK_API_BASE;
  mocks.fetchChartOption.mockResolvedValue({ option: { a: 1 }, computedAt: '2026-07-06T12:00:00Z' });
});

describe('scan', () => {
  it('유효한 [data-chart-id] 를 렌더 마킹하고 데이터를 요청한다', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-chart-id="12" data-auth-token="TKN"></div>';
    mod.scan();
    const el = document.querySelector('[data-chart-id]')!;
    expect(el.hasAttribute('data-chart-rendered')).toBe(true);
    expect(mocks.fetchChartOption).toHaveBeenCalledWith(expect.any(String), '12', 'TKN');
  });

  it('토큰이 없으면 건너뛰고 마킹하지 않는다', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-chart-id="12"></div>';
    mod.scan();
    expect(document.querySelector('[data-chart-id]')!.hasAttribute('data-chart-rendered')).toBe(false);
    expect(mocks.fetchChartOption).not.toHaveBeenCalled();
  });

  it('이미 렌더된 요소는 다시 요청하지 않는다(중복 방지)', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-chart-id="12" data-auth-token="T" data-chart-rendered></div>';
    mod.scan();
    expect(mocks.fetchChartOption).not.toHaveBeenCalled();
  });

  it('window.CHARTSDK_API_BASE 를 apiBase 로 사용한다', async () => {
    (window as unknown as { CHARTSDK_API_BASE?: string }).CHARTSDK_API_BASE = 'http://custom.test';
    const mod = await import('./index');
    document.body.innerHTML = '<div data-chart-id="7" data-auth-token="T"></div>';
    mod.scan();
    expect(mocks.fetchChartOption).toHaveBeenCalledWith('http://custom.test', '7', 'T');
  });

  it('로드 시 기존 [data-chart-id] 를 자동 스캔한다', async () => {
    document.body.innerHTML = '<div data-chart-id="99" data-auth-token="T"></div>';
    await import('./index'); // 로드 부수효과로 scan
    if (!document.querySelector('[data-chart-rendered]')) {
      document.dispatchEvent(new Event('DOMContentLoaded')); // readyState==='loading' 대비
      await tick();
    }
    expect(document.querySelector('[data-chart-id]')!.hasAttribute('data-chart-rendered')).toBe(true);
    expect(mocks.fetchChartOption).toHaveBeenCalledWith(expect.any(String), '99', 'T');
  });
});

describe('render', () => {
  it('데이터 성공 시 renderChart 를 호출한다', async () => {
    mocks.fetchChartOption.mockResolvedValue({ option: { x: 1 }, computedAt: 'c' });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { chartId: '3', token: 'T' });
    expect(mocks.renderChart).toHaveBeenCalledWith(el, { x: 1 }, 'c');
    expect(mocks.renderError).not.toHaveBeenCalled();
  });

  it('데이터 실패 시 renderError 로 호스트를 지킨다', async () => {
    mocks.fetchChartOption.mockRejectedValue(new Error('401'));
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { chartId: '3', token: 'bad' });
    expect(mocks.renderError).toHaveBeenCalledWith(el);
    expect(mocks.renderChart).not.toHaveBeenCalled();
  });
});
