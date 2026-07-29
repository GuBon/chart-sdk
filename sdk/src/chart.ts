// ECharts core + 필요한 차트/컴포넌트/렌더러만 등록(임베드 SDK 번들 최소화).
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, BoxplotChart, HeatmapChart, MapChart } from 'echarts/charts';
import { DataZoomComponent, GeoComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, VisualMapComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { responsiveTitlePatch, usesResponsiveTitle, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';
import { confidenceBadgeText, samplingMethodLabel, samplingWarningMessage, type SamplingMetadata } from '@chartsdk/chart-options/sampling';
import { hydrateValueFormat } from '@chartsdk/chart-options/valueFormat';

// GeoComponent: 지도 포인트(geoscatter)가 독립 geo 좌표계(option.geo)를 쓰므로 명시 등록.
// (map 시리즈 단독은 MapChart 의 installGeo 로 충분하지만, option.geo 컴포넌트는 별도 등록 필요)
echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, BoxplotChart, HeatmapChart, MapChart,
  DataZoomComponent, GeoComponent, GridComponent, TooltipComponent, LegendComponent, TitleComponent, VisualMapComponent,
  LabelLayout,
  CanvasRenderer,
]);

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 컨테이너에 차트를 렌더하고 크기 변화를 추종(ResizeObserver)한다.
// computedAt 이 있으면 하단에 "데이터 기준 {시각}" 캡션을 표시(PRD 7.7 / 화면설계 S4-정상).
// 크기·반응형은 호스트 페이지 CSS 책임 — SDK 는 따라가기만 한다.
// 임베드 방어(호스트 CSS 로부터): ①높이 0 폴백 ②클라이언트 position 존중 ③canvas reset 무력화
// ④data-chart-background 로 배경 오버라이드(다크 사이트 대응). 캡션/에러 스타일은 인라인으로 강하게
// 잠그고 .chartsdk-* 클래스를 공식 오버라이드 훅으로만 연다.
export function renderChart(el: HTMLElement, option: Record<string, unknown>, computedAt?: string,
                            sampling?: SamplingMetadata): () => void {
  const previousStyle = {
    position: el.style.position,
    minHeight: el.style.minHeight,
    display: el.style.display,
    flexDirection: el.style.flexDirection,
  };
  let changedPosition = false;
  let changedMinHeight = false;

  el.innerHTML = '';
  el.removeAttribute('data-chart-error');
  // 클라이언트가 지정한 positioning 을 존중 — 인라인(빠른 경로) → 스타일시트(getComputedStyle) 순으로 확인하고
  // static/미지정일 때만 툴팁 기준점을 위해 relative 부여.
  const pos = el.style.position || getComputedStyle(el).position;
  if (!pos || pos === 'static') {
    el.style.position = 'relative';
    changedPosition = true;
  }
  // 높이 방어: 호스트가 높이를 주지 않아 컨테이너가 0px 이면 차트가 사라진다 → 최소 높이 폴백.
  if (el.clientHeight === 0) {
    el.style.minHeight = '320px';
    changedMinHeight = true;
  }
  // 내부는 flex 컬럼 — 차트(신축) + 캡션(고정). 캡션 폰트가 커져도 겹치지 않는다(calc 하드코딩 제거).
  el.style.display = 'flex';
  el.style.flexDirection = 'column';

  const host = document.createElement('div');
  // margin/border/padding 리셋: 전역 `div{border:...}` 류 유탄이 SDK 내부 래퍼에 끼는 것 차단.
  host.style.cssText = 'flex:1 1 auto;min-height:0;width:100%;margin:0;border:0;padding:0;';
  el.appendChild(host);

  const chart = echarts.init(host);
  // canvas reset 방어: 클라이언트의 `canvas{max-width:100%}` 류가 표시 크기를 줄여 좌표·클릭이 어긋나는 것 차단.
  // 캔버스는 커스터마이징 표면이 아니므로(협상 불가) !important 리셋까지 이기도록 인라인 important 로 잠근다.
  // 주의: canvas 는 첫 페인트 때 비동기 생성되고 레이어가 늘 수 있어 init 직후가 아니라 rendered 마다 고정(멱등).
  chart.on('rendered', () => {
    for (const c of host.querySelectorAll('canvas')) {
      c.style.setProperty('max-width', 'none', 'important');
      c.style.setProperty('max-height', 'none', 'important');
    }
  });
  // 배경 오버라이드: 컨테이너에 data-chart-background 가 있으면 그 값으로(예: 다크 사이트 'transparent').
  const bg = el.getAttribute('data-chart-background');
  const {
    __chartsdkAutoColorMap: _autoColorMap,
    __chartsdkShowComputedAt: showComputedAt,
    ...publicOptionSource
  } = option;
  const publicOption = hydrateValueFormat(structuredClone(publicOptionSource));
  const baseOption = bg ? { ...publicOption, backgroundColor: bg } : publicOption;

  // 긴 제목이 컨테이너 밖으로 잘리지 않도록 말줄임(…). title.textStyle.width 는 컨테이너 크기 의존이라
  // 크기를 모르는 서버가 아니라 렌더러가 주입한다("크기·반응형은 렌더 측 책임" 원칙). resize 마다 갱신.
  const hasTitle = usesResponsiveTitle(baseOption);
  chart.setOption(withResponsiveTitle(baseOption, host.clientWidth));

  const observer = new ResizeObserver(() => {
    chart.resize();
    // width와 truncate를 함께 재명시해 ECharts 병합 방식에 기대지 않고 렌더 계약을 유지한다.
    if (hasTitle) chart.setOption(responsiveTitlePatch(host.clientWidth));
  });
  observer.observe(host);

  const displayedComputedAt = showComputedAt !== false ? computedAt : undefined;
  if (displayedComputedAt || sampling) {
    const cap = document.createElement('div');
    cap.className = 'chartsdk-caption';
    cap.setAttribute('data-chart-caption', '');
    const captionParts: string[] = [];
    if (sampling) {
      cap.setAttribute('data-chart-sampling', `${sampling.method}:${sampling.rate ?? ''}`);
      const confidence = confidenceBadgeText(sampling);
      if (confidence) cap.setAttribute('data-chart-confidence', confidence);
      captionParts.push(sampling.approximate
        ? [`${samplingMethodLabel(sampling.method)}${sampling.sampledRowCount !== undefined ? ` ${sampling.sampledRowCount.toLocaleString()}행` : ''}`,
           '표본 결과', confidence].filter(Boolean).join(' · ')
        : '전체 데이터 · 정확한 결과');
    }
    if (displayedComputedAt) captionParts.push(`데이터 기준 ${formatTime(displayedComputedAt)}`);
    cap.textContent = captionParts.join(' · ');
    // font/color 외에 border·margin·background·letter-spacing 도 명시 — 전역 div 규칙의 유탄을 전부 차단.
    cap.style.cssText =
      'flex:0 0 auto;font:11px/16px system-ui,sans-serif;color:#999;text-align:right;padding:4px 0 0;' +
      'margin:0;border:0;background:none;letter-spacing:normal;';
    el.appendChild(cap);
  }

  if (sampling?.approximate) {
    const warning = document.createElement('div');
    warning.className = 'chartsdk-sampling-warning';
    warning.setAttribute('data-chart-sampling-warning', '');
    const warningCodes = sampling.warnings?.length ? sampling.warnings : ['BLOCK_SAMPLE_CLUSTERING'] as const;
    warning.textContent = [...warningCodes].map(samplingWarningMessage).join(' ');
    warning.style.cssText =
      'flex:0 0 auto;font:11px/16px system-ui,sans-serif;color:#92400e;text-align:left;padding:4px 8px;' +
      'margin:4px 0 0;border:1px solid #fde68a;border-radius:4px;background:#fffbeb;letter-spacing:normal;';
    el.appendChild(warning);
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    chart.dispose();
    el.innerHTML = '';
    if (changedPosition && el.style.position === 'relative') el.style.position = previousStyle.position;
    if (changedMinHeight && el.style.minHeight === '320px') el.style.minHeight = previousStyle.minHeight;
    if (el.style.display === 'flex') el.style.display = previousStyle.display;
    if (el.style.flexDirection === 'column') el.style.flexDirection = previousStyle.flexDirection;
  };
}

// 임베드 실패는 호스트 페이지를 깨뜨리지 않고 컨테이너 안에서만 표시 (화면설계 S4-에러).
// 원인(만료/회수/서명)은 구분 노출하지 않는다(정보 최소화).
// 기본 스타일은 내부 래퍼에만 적용해 호스트의 width/height/position 등 인라인 스타일을 보존한다.
// .chartsdk-error 클래스를 공식 오버라이드 훅으로 연다(의도적 변경은 `.chartsdk-error{...!important}`).
export function renderError(el: HTMLElement, message = '차트를 표시할 수 없습니다'): void {
  el.innerHTML = '';
  el.setAttribute('data-chart-error', '');
  const error = document.createElement('div');
  error.className = 'chartsdk-error';
  error.textContent = message;
  error.style.cssText =
    'display:flex;align-items:center;justify-content:center;min-height:120px;box-sizing:border-box;' +
    'padding:16px;font:13px/1.5 system-ui,sans-serif;color:#999;text-align:center;letter-spacing:normal;';
  el.appendChild(error);
}
