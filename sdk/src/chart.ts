// ECharts core + 필요한 차트/컴포넌트/렌더러만 등록(임베드 SDK 번들 최소화).
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
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
export function renderChart(el: HTMLElement, option: Record<string, unknown>, computedAt?: string): () => void {
  el.innerHTML = '';
  if (!el.style.position) el.style.position = 'relative';

  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = computedAt ? 'calc(100% - 20px)' : '100%';
  el.appendChild(host);

  const chart = echarts.init(host);
  chart.setOption(option);

  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(host);

  if (computedAt) {
    const cap = document.createElement('div');
    cap.setAttribute('data-chart-caption', '');
    cap.textContent = `데이터 기준 ${formatTime(computedAt)}`;
    cap.style.cssText = 'font:11px/16px system-ui,sans-serif;color:#999;text-align:right;padding-top:4px;';
    el.appendChild(cap);
  }

  return () => {
    observer.disconnect();
    chart.dispose();
    el.innerHTML = '';
  };
}

// 임베드 실패는 호스트 페이지를 깨뜨리지 않고 컨테이너 안에서만 표시 (화면설계 S4-에러).
// 원인(만료/회수/서명)은 구분 노출하지 않는다(정보 최소화).
export function renderError(el: HTMLElement, message = '차트를 표시할 수 없습니다'): void {
  el.setAttribute('data-chart-error', '');
  el.textContent = message;
}
