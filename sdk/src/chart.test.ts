import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// echarts 는 mock — 실픽셀(canvas) 렌더는 라이브 스위프가 담당. 여기선 SDK 자체 DOM 로직만 검증.
const ec = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() };
  return { instance, init: vi.fn(() => instance) };
});
vi.mock('echarts/core', () => ({ use: vi.fn(), init: ec.init }));
vi.mock('echarts/charts', () => ({ BarChart: {}, LineChart: {}, PieChart: {}, ScatterChart: {}, BoxplotChart: {}, HeatmapChart: {}, MapChart: {} }));
vi.mock('echarts/components', () => ({
  DataZoomComponent: {},
  GeoComponent: {},
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  VisualMapComponent: {},
}));
vi.mock('echarts/features', () => ({ LabelLayout: {} }));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import { renderChart, renderError } from './chart';

const roDisconnect = vi.fn();
let roCallback: ResizeObserverCallback | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  roCallback = undefined;
  // 콜백을 보관해 resize 후 제목 폭 갱신까지 결정적으로 검증한다.
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { roCallback = callback; }
    observe() {}
    disconnect() { roDisconnect(); }
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(cap?.classList.contains('chartsdk-caption')).toBe(true); // 공식 오버라이드 훅
  });

  it('showComputedAt=false면 기준 시각을 숨기고 내부 메타데이터를 ECharts에 넘기지 않는다', () => {
    const el = document.createElement('div');
    renderChart(el, {
      __chartsdkShowComputedAt: false,
      series: [{ type: 'bar' }],
    }, '2026-07-06T12:00:00Z');

    expect(el.querySelector('[data-chart-caption]')).toBeNull();
    expect(ec.instance.setOption).toHaveBeenCalledWith({ series: [{ type: 'bar' }] });
  });

  it('SYSTEM 표본 메타데이터는 방식 라벨과 실제 표본수를 캡션에 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, '2026-07-06T12:00:00Z', {
      version: 5, mode: 'manual', requestedMethod: 'system', approximate: true, method: 'SYSTEM', rate: 10, seed: 48291,
      valueMode: 'sample', sampledRowCount: 1234, warnings: ['BLOCK_SAMPLE_CLUSTERING'],
    });
    const cap = el.querySelector('[data-chart-caption]');
    expect(cap?.textContent).toMatch(/블록 표본 1,234행 · 표본 결과 · 데이터 기준/);
    expect(cap?.getAttribute('data-chart-sampling')).toBe('SYSTEM:10');
    expect(el.querySelector('[data-chart-sampling-warning]')?.textContent).toMatch(/블록 표본/);
  });

  it('INDEX_RANDOM 표본은 무작위 행 표본 라벨과 95% 오차범위 배지를 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, undefined, {
      version: 5, mode: 'auto', requestedMethod: 'auto', approximate: true, method: 'INDEX_RANDOM', seed: 48291,
      valueMode: 'sample', populationEstimate: 2_500_000, sampleSize: 10_000, sampledRowCount: 9998,
      confidenceLevel: 0.95, warnings: ['INDEX_RANDOM_SAMPLE'],
      estimates: [{ series: 'avg_amount', aggregate: 'avg', treatment: 'SAMPLE_ESTIMATE', relativeErrorPct: 1.2 }],
    });
    const cap = el.querySelector('[data-chart-caption]');
    expect(cap?.textContent).toMatch(/무작위 행 표본 9,998행 · 표본 결과 · 95% 신뢰수준 · 오차 약 ±1\.2%/);
    expect(cap?.getAttribute('data-chart-confidence')).toBe('95% 신뢰수준 · 오차 약 ±1.2%');
  });

  it('RESULT_RANDOM은 조인·뷰 조회 결과에서 뽑은 표본임을 구분해 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, undefined, {
      version: 6, mode: 'manual', requestedMethod: 'auto', approximate: true, method: 'RESULT_RANDOM', seed: 321,
      valueMode: 'sample', sampleSize: 12_000, sampledRowCount: 11_998, confidenceLevel: 0.95,
      warnings: ['RESULT_RANDOM_SAMPLE'],
      estimates: [{ series: 'avg_amount', aggregate: 'avg', treatment: 'SAMPLE_ESTIMATE', relativeErrorPct: 1.7 }],
    });

    expect(el.querySelector('[data-chart-caption]')?.textContent)
      .toContain('결과 무작위 행 표본 11,998행 · 표본 결과 · 95% 신뢰수준 · 오차 약 ±1.7%');
    expect(el.querySelector('[data-chart-sampling-warning]')?.textContent)
      .toContain('조회 결과에서 무작위로 선택된 행');
  });

  it('표본 SUM·COUNT는 전체 추정 배지 없이 표본값 주의문구를 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, undefined, {
      version: 5, mode: 'manual', requestedMethod: 'auto', approximate: true, method: 'INDEX_RANDOM', seed: 48291,
      valueMode: 'sample', sampledRowCount: 10_000, confidenceLevel: 0.95,
      warnings: ['INDEX_RANDOM_SAMPLE', 'SAMPLE_AGGREGATE_ONLY'],
      estimates: [{ series: 'sum_amount', aggregate: 'sum', treatment: 'SAMPLE_AGGREGATE' }],
    });

    expect(el.querySelector('[data-chart-caption]')?.textContent).toBe('무작위 행 표본 10,000행 · 표본 결과');
    expect(el.querySelector('[data-chart-caption]')?.hasAttribute('data-chart-confidence')).toBe(false);
    expect(el.querySelector('[data-chart-sampling-warning]')?.textContent).toContain('전체 데이터의 합계·개수가 아닙니다');
  });

  it('표준편차 추정은 95% 오차 배지와 정규성 가정 주의문구를 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, undefined, {
      version: 5, mode: 'auto', requestedMethod: 'auto', approximate: true, method: 'INDEX_RANDOM', seed: 48291,
      valueMode: 'sample', sampledRowCount: 10_000, confidenceLevel: 0.95,
      warnings: ['INDEX_RANDOM_SAMPLE', 'STDDEV_CI_NORMALITY_ASSUMED'],
      estimates: [{
        series: 'stddev_amount', aggregate: 'stddev', treatment: 'SAMPLE_ESTIMATE', relativeErrorPct: 16.2,
        intervals: [{ key: 'A', sampleCount: 100, estimate: 10, lower95: 8.78, upper95: 11.62, relativeErrorPct: 16.2 }],
      }],
    });

    expect(el.querySelector('[data-chart-caption]')?.textContent).toContain('95% 신뢰수준 · 오차 약 ±16.2%');
    expect(el.querySelector('[data-chart-sampling-warning]')?.textContent).toContain('정규분포에 가깝다는 가정');
  });

  it('100% 실행은 근사치가 아니라 정확한 전체 데이터로 표시한다', () => {
    const el = document.createElement('div');
    renderChart(el, {}, undefined, {
      version: 5, mode: 'manual', requestedMethod: 'auto', approximate: false, method: 'FULL_SCAN', rate: 100, valueMode: 'exact',
    });
    expect(el.querySelector('[data-chart-caption]')?.textContent).toBe('전체 데이터 · 정확한 결과');
    expect(el.querySelector('[data-chart-sampling-warning]')).toBeNull();
  });

  it('높이가 0인 컨테이너에는 최소 높이 폴백을 준다(차트 붕괴 방지)', () => {
    const el = document.createElement('div'); // detached → clientHeight 0
    renderChart(el, {});
    expect(el.style.minHeight).toBe('320px');
  });

  it('클라이언트가 지정한 position 은 존중하고, static 일 때만 relative 를 준다', () => {
    const styled = document.createElement('div');
    styled.style.position = 'absolute';
    renderChart(styled, {});
    expect(styled.style.position).toBe('absolute'); // 덮어쓰지 않음

    const plain = document.createElement('div');
    renderChart(plain, {});
    expect(plain.style.position).toBe('relative'); // 툴팁 기준점 부여
  });

  it('data-chart-background 가 있으면 배경을 오버라이드해 setOption 한다', () => {
    const el = document.createElement('div');
    el.setAttribute('data-chart-background', 'transparent');
    renderChart(el, { series: [] });
    expect(ec.instance.setOption).toHaveBeenCalledWith({ series: [], backgroundColor: 'transparent' });
  });

  it('제목이 있으면 title.textStyle 에 width·truncate 를 주입해 말줄임한다', () => {
    const el = document.createElement('div');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValueOnce(400).mockReturnValue(240);
    renderChart(el, { title: { text: '아주 긴 제목', left: 'center', textStyle: { fontSize: 18 } }, series: [] });
    const arg = ec.instance.setOption.mock.calls[0][0] as { title: { text: string; left: string; textStyle: Record<string, unknown> } };
    expect(arg.title.text).toBe('아주 긴 제목'); // 기존 title 속성 보존
    expect(arg.title.left).toBe('center');
    expect(arg.title.textStyle.fontSize).toBe(18);
    expect(arg.title.textStyle.overflow).toBe('truncate');
    expect(arg.title.textStyle.width).toBe(368); // 400 - 좌우 inset 32

    roCallback?.([], {} as ResizeObserver);
    expect(ec.instance.resize).toHaveBeenCalledOnce();
    expect(ec.instance.setOption).toHaveBeenLastCalledWith({
      title: { textStyle: { width: 208, overflow: 'truncate' } },
    });
  });

  it('임베드 컨테이너 리사이즈는 모든 글자 px를 유지하고 제목 폭만 보정한다', () => {
    const el = document.createElement('div');
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValueOnce(800).mockReturnValue(400);
    renderChart(el, {
      title: { text: 'FHD 차트', textStyle: { fontSize: 26 } },
      legend: { textStyle: { fontSize: 16 } },
      tooltip: { textStyle: { fontSize: 15 } },
      xAxis: { axisLabel: { fontSize: 16 }, nameTextStyle: { fontSize: 16 } },
      yAxis: { axisLabel: { fontSize: 16 }, nameTextStyle: { fontSize: 16 } },
      series: [{ type: 'bar', label: { show: true, fontSize: 14 } }],
    });

    const initial = ec.instance.setOption.mock.calls[0][0] as {
      title: { textStyle: Record<string, unknown> };
      legend: { textStyle: Record<string, unknown> };
      tooltip: { textStyle: Record<string, unknown> };
      xAxis: { axisLabel: Record<string, unknown> };
      yAxis: { nameTextStyle: Record<string, unknown> };
      series: Array<{ label: Record<string, unknown> }>;
    };
    expect(initial.title.textStyle).toMatchObject({ fontSize: 26, width: 768, overflow: 'truncate' });
    expect(initial.legend.textStyle.fontSize).toBe(16);
    expect(initial.tooltip.textStyle.fontSize).toBe(15);
    expect(initial.xAxis.axisLabel.fontSize).toBe(16);
    expect(initial.yAxis.nameTextStyle.fontSize).toBe(16);
    expect(initial.series[0].label.fontSize).toBe(14);

    roCallback?.([], {} as ResizeObserver);
    expect(ec.instance.resize).toHaveBeenCalledOnce();
    const resizePatch = ec.instance.setOption.mock.calls.at(-1)?.[0];
    expect(resizePatch).toEqual({ title: { textStyle: { width: 368, overflow: 'truncate' } } });
    expect(JSON.stringify(resizePatch)).not.toContain('fontSize');
  });

  it('제목이 없으면 title 을 주입하지 않는다', () => {
    const el = document.createElement('div');
    renderChart(el, { series: [] });
    expect(ec.instance.setOption).toHaveBeenCalledWith({ series: [] });
  });

  it('computedAt 가 없으면 캡션이 없다', () => {
    const el = document.createElement('div');
    renderChart(el, {});
    expect(el.querySelector('[data-chart-caption]')).toBeNull();
  });

  it('반환된 cleanup 은 dispose·observer disconnect·컨테이너 비움을 수행한다', () => {
    const el = document.createElement('div');
    el.style.display = 'block';
    const cleanup = renderChart(el, {});
    cleanup();
    expect(ec.instance.dispose).toHaveBeenCalledOnce();
    expect(roDisconnect).toHaveBeenCalledOnce();
    expect(el.innerHTML).toBe('');
    expect(el.style.display).toBe('block');
    expect(el.style.position).toBe('');
    expect(el.style.minHeight).toBe('');

    cleanup();
    expect(ec.instance.dispose).toHaveBeenCalledOnce();
  });
});

describe('renderError', () => {
  it('data-chart-error 속성과 기본 메시지를 표시한다', () => {
    const el = document.createElement('div');
    renderError(el);
    expect(el.hasAttribute('data-chart-error')).toBe(true);
    expect(el.textContent).toBe('차트를 표시할 수 없습니다');
  });

  it('내부 래퍼에 chartsdk-error 클래스와 기본 스타일을 건다', () => {
    const el = document.createElement('div');
    renderError(el);
    const error = el.querySelector<HTMLElement>('.chartsdk-error');
    expect(error).not.toBeNull();
    expect(error?.style.color).toBe('#999');
  });

  it('호스트의 인라인 크기·배치 스타일을 보존한다', () => {
    const el = document.createElement('div');
    el.style.cssText = 'width:600px;height:300px;position:absolute;background:#111;';
    const before = el.style.cssText;
    renderError(el);
    expect(el.style.cssText).toBe(before);
  });

  it('커스텀 메시지를 표시한다', () => {
    const el = document.createElement('div');
    renderError(el, '토큰 만료');
    expect(el.textContent).toBe('토큰 만료');
  });
});
