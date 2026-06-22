import * as echarts from 'echarts';

// 컨테이너에 차트를 렌더하고 크기 변화를 추종(ResizeObserver)한다.
// 크기·반응형은 호스트 페이지 CSS 책임 — SDK 는 따라가기만 한다.
export function renderChart(el: HTMLElement, option: Record<string, unknown>): () => void {
  const chart = echarts.init(el);
  chart.setOption(option);

  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(el);

  return () => {
    observer.disconnect();
    chart.dispose();
  };
}

// 임베드 실패는 호스트 페이지를 깨뜨리지 않고 컨테이너 안에서만 표시 (화면설계 S4-에러).
// 원인(만료/회수/서명)은 구분 노출하지 않는다(정보 최소화).
export function renderError(el: HTMLElement, message = '차트를 표시할 수 없습니다'): void {
  el.setAttribute('data-chart-error', '');
  el.textContent = message;
}
