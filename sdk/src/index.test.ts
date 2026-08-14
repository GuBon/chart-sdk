import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLING_CONTRACT_VERSION } from '@chartsdk/chart-options/sampling';

// index.ts 는 로드 시 부수효과(apiBase 확정 + 자동 scan)가 있어, 테스트마다 resetModules + 동적 import 로 재평가한다.
// api·chart 는 mock — 네트워크·echarts 를 차단하고 index 의 분기 로직만 검증.
const mocks = vi.hoisted(() => ({
  fetchChartOption: vi.fn(),
  resolveEmbedTimeoutMs: vi.fn(() => 150_000),
  resolveEmbedMapTimeoutMs: vi.fn(() => 15_000),
  renderChart: vi.fn(),
  renderError: vi.fn(),
  renderEmpty: vi.fn(),
  renderLoading: vi.fn(),
  ensureMapsRegistered: vi.fn(),
}));
vi.mock('./api', () => ({
  fetchChartOption: mocks.fetchChartOption,
  resolveEmbedTimeoutMs: mocks.resolveEmbedTimeoutMs,
  resolveEmbedMapTimeoutMs: mocks.resolveEmbedMapTimeoutMs,
}));
vi.mock('./chart', () => ({
  renderChart: mocks.renderChart,
  renderError: mocks.renderError,
  renderEmpty: mocks.renderEmpty,
  renderLoading: mocks.renderLoading,
}));
vi.mock('./geo', () => ({ ensureMapsRegistered: mocks.ensureMapsRegistered }));

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as { CHARTSDK_API_BASE?: string }).CHARTSDK_API_BASE;
  mocks.fetchChartOption.mockResolvedValue({ option: { a: 1 }, computedAt: '2026-07-06T12:00:00Z' });
  mocks.resolveEmbedTimeoutMs.mockReturnValue(150_000);
  mocks.resolveEmbedMapTimeoutMs.mockReturnValue(15_000);
  mocks.renderChart.mockReturnValue(vi.fn());
  mocks.ensureMapsRegistered.mockResolvedValue(undefined);
});

describe('scan', () => {
  it('유효한 [data-embed-key] 를 렌더 마킹하고 데이터를 요청한다', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-embed-key="cek1_101_sig"></div>';
    mod.scan();
    const el = document.querySelector('[data-embed-key]')!;
    expect(el.hasAttribute('data-chart-rendered')).toBe(true);
    expect(mocks.fetchChartOption).toHaveBeenCalledWith(expect.any(String), 'cek1_101_sig', expect.any(Number));
  });

  it('임베드 코드에는 chartId 가 없다 — 키가 비어 있으면 건너뛰고 마킹하지 않는다', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-embed-key=""></div>';
    mod.scan();
    expect(document.querySelector('[data-embed-key]')!.hasAttribute('data-chart-rendered')).toBe(false);
    expect(mocks.fetchChartOption).not.toHaveBeenCalled();
  });

  it('구 계약 [data-chart-id] 슬롯은 더 이상 스캔하지 않는다', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-chart-id="12" data-auth-token="TKN"></div>';
    mod.scan();
    expect(document.querySelector('[data-chart-id]')!.hasAttribute('data-chart-rendered')).toBe(false);
    expect(mocks.fetchChartOption).not.toHaveBeenCalled();
  });

  it('이미 렌더된 요소는 다시 요청하지 않는다(중복 방지)', async () => {
    const mod = await import('./index');
    document.body.innerHTML = '<div data-embed-key="cek1_1_sig" data-chart-rendered></div>';
    mod.scan();
    expect(mocks.fetchChartOption).not.toHaveBeenCalled();
  });

  it('window.CHARTSDK_API_BASE 를 apiBase 로 사용한다', async () => {
    (window as unknown as { CHARTSDK_API_BASE?: string }).CHARTSDK_API_BASE = 'http://custom.test';
    const mod = await import('./index');
    document.body.innerHTML = '<div data-embed-key="cek1_7_sig"></div>';
    mod.scan();
    expect(mocks.fetchChartOption).toHaveBeenCalledWith('http://custom.test', 'cek1_7_sig', expect.any(Number));
  });

  it('sdk script의 data-api-base를 API 출처로 사용한다', async () => {
    const script = document.createElement('script');
    script.src = 'http://assets.test/sdk.js';
    script.dataset.apiBase = 'http://api.test/';
    const original = Object.getOwnPropertyDescriptor(document, 'currentScript');
    Object.defineProperty(document, 'currentScript', { configurable: true, value: script });
    try {
      const mod = await import('./index');
      document.body.innerHTML = '<div data-embed-key="cek1_7_sig"></div>';
      mod.scan();

      expect(mocks.fetchChartOption).toHaveBeenCalledWith('http://api.test', 'cek1_7_sig', expect.any(Number));
    } finally {
      if (original) Object.defineProperty(document, 'currentScript', original);
      else delete (document as unknown as { currentScript?: HTMLScriptElement }).currentScript;
    }
  });

  it('로드 시 기존 [data-embed-key] 를 자동 스캔한다', async () => {
    document.body.innerHTML = '<div data-embed-key="cek1_99_sig"></div>';
    await import('./index'); // 로드 부수효과로 scan
    if (!document.querySelector('[data-chart-rendered]')) {
      document.dispatchEvent(new Event('DOMContentLoaded')); // readyState==='loading' 대비
      await tick();
    }
    expect(document.querySelector('[data-embed-key]')!.hasAttribute('data-chart-rendered')).toBe(true);
    expect(mocks.fetchChartOption).toHaveBeenCalledWith(expect.any(String), 'cek1_99_sig', expect.any(Number));
  });
});

describe('render', () => {
  it('데이터 성공 시 renderChart 를 호출한다', async () => {
    mocks.fetchChartOption.mockResolvedValue({ option: { x: 1 }, computedAt: 'c' });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderChart).toHaveBeenCalledWith(el, { x: 1 }, 'c', undefined);
    expect(mocks.renderError).not.toHaveBeenCalled();
  });

  it('데이터 도착 전에 로딩 placeholder 를 표시한다', async () => {
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderLoading).toHaveBeenCalledWith(el);
  });

  it('rowCount 0 이면 빈 상태를 표시하고 차트를 그리지 않는다', async () => {
    mocks.fetchChartOption.mockResolvedValue({ option: { x: 1 }, computedAt: 'c', rowCount: 0 });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderEmpty).toHaveBeenCalledWith(el);
    expect(mocks.renderChart).not.toHaveBeenCalled();
    expect(mocks.renderError).not.toHaveBeenCalled();
  });

  it('rowCount 가 0보다 크면 정상적으로 차트를 그린다', async () => {
    mocks.fetchChartOption.mockResolvedValue({ option: { x: 1 }, computedAt: 'c', rowCount: 5 });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderChart).toHaveBeenCalledWith(el, { x: 1 }, 'c', undefined);
    expect(mocks.renderEmpty).not.toHaveBeenCalled();
  });

  it('표본 메타데이터를 정규화해 렌더러에 전달한다', async () => {
    mocks.fetchChartOption.mockResolvedValue({
      option: { x: 1 },
      computedAt: 'c',
      sampling: {
        version: 2, approximate: true, method: 'SYSTEM', mode: 'auto', rate: 10, seed: 77,
        valueMode: 'population_estimate', sampledRowCount: 456, warnings: ['BLOCK_SAMPLE_CLUSTERING'],
      },
    });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderChart).toHaveBeenCalledWith(
      el,
      { x: 1 },
      'c',
      {
        version: 2, mode: 'auto', requestedMethod: 'auto', approximate: true, method: 'SYSTEM', rate: 10, seed: 77,
        valueMode: 'population_estimate', sampledRowCount: 456, warnings: ['BLOCK_SAMPLE_CLUSTERING'],
      },
    );
  });

  it('정식 INDEX_RANDOM 계약에는 레거시 sampleRate 별칭을 rate로 역주입하지 않는다', async () => {
    mocks.fetchChartOption.mockResolvedValue({
      option: { x: 1 },
      computedAt: 'c',
      approximate: true,
      sampleRate: 0.1,
      sampling: {
        version: 5, mode: 'auto', requestedMethod: 'auto', approximate: true,
        method: 'INDEX_RANDOM', valueMode: 'sample', seed: 77,
        populationEstimate: 500_000_000, sampleSize: 10_000, sampledRowCount: 9_998,
      },
    });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });

    const sampling = mocks.renderChart.mock.calls[0][3] as Record<string, unknown>;
    expect(sampling.rate).toBeUndefined();
    expect(sampling.populationEstimate).toBe(500_000_000);
    expect(sampling.sampleSize).toBe(10_000);
  });

  it('RESERVOIR_RANDOM의 실측 모집단을 손실 없이 렌더러에 전달한다', async () => {
    mocks.fetchChartOption.mockResolvedValue({
      option: { x: 1 },
      computedAt: 'c',
      sampling: {
        version: SAMPLING_CONTRACT_VERSION,
        mode: 'auto', requestedMethod: 'auto', approximate: true,
        method: 'RESERVOIR_RANDOM', valueMode: 'sample', seed: 77,
        populationCount: 1_000_000, sampleSize: 10_000, sampledRowCount: 10_000,
        warnings: ['RESERVOIR_RANDOM_SAMPLE'],
      },
    });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });

    const sampling = mocks.renderChart.mock.calls[0][3] as Record<string, unknown>;
    expect(sampling.method).toBe('RESERVOIR_RANDOM');
    expect(sampling.populationCount).toBe(1_000_000);
  });

  it('레거시 approximate/sampleRate 응답도 정식 sampling 계약으로 승격한다', async () => {
    mocks.fetchChartOption.mockResolvedValue({ option: {}, computedAt: 'c', approximate: true, sampleRate: 25 });
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_3_sig' });
    expect(mocks.renderChart).toHaveBeenCalledWith(
      el,
      {},
      'c',
      {
        version: SAMPLING_CONTRACT_VERSION, mode: 'manual', requestedMethod: 'auto', approximate: true, method: 'SYSTEM', rate: 25,
        valueMode: 'sample',
      },
    );
  });

  it('데이터 실패 시 renderError 로 호스트를 지킨다', async () => {
    mocks.fetchChartOption.mockRejectedValue(new Error('401'));
    const mod = await import('./index');
    const el = document.createElement('div');
    await mod.render(el, { embedKey: 'cek1_bad_sig' });
    expect(mocks.renderError).toHaveBeenCalledWith(el);
    expect(mocks.renderChart).not.toHaveBeenCalled();
  });

  it('같은 요소를 다시 렌더하면 기존 차트를 먼저 정리한다', async () => {
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    mocks.renderChart.mockReturnValueOnce(firstCleanup).mockReturnValueOnce(secondCleanup);
    const mod = await import('./index');
    const el = document.createElement('div');

    await mod.render(el, { embedKey: 'cek1_3_sig' });
    await mod.render(el, { embedKey: 'cek1_4_sig' });

    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).not.toHaveBeenCalled();
  });

  it('dispose 는 활성 차트를 정리하고 자동 스캔 마커를 제거한다', async () => {
    const cleanup = vi.fn();
    mocks.renderChart.mockReturnValue(cleanup);
    const mod = await import('./index');
    const el = document.createElement('div');
    el.setAttribute('data-chart-rendered', '');

    await mod.render(el, { embedKey: 'cek1_3_sig' });
    mod.dispose(el);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(el.hasAttribute('data-chart-rendered')).toBe(false);
  });

  it('늦게 끝난 이전 요청은 최신 렌더 결과를 덮어쓰지 않는다', async () => {
    let resolveFirst!: (value: { option: Record<string, unknown>; computedAt: string }) => void;
    mocks.fetchChartOption
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ option: { current: true }, computedAt: 'new' });
    const mod = await import('./index');
    const el = document.createElement('div');

    const first = mod.render(el, { embedKey: 'cek1_3_sig' });
    await mod.render(el, { embedKey: 'cek1_4_sig' });
    resolveFirst({ option: { stale: true }, computedAt: 'old' });
    await first;

    expect(mocks.renderChart).toHaveBeenCalledTimes(1);
    expect(mocks.renderChart).toHaveBeenCalledWith(el, { current: true }, 'new', undefined);
  });
});
