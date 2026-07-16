import { fetchChartOption } from './api';
import { renderChart, renderError } from './chart';
import { ensureMapsRegistered } from './geo';
import { normalizeSampling } from '@chartsdk/chart-options/sampling';

const ATTR_ID = 'data-chart-id';
const ATTR_TOKEN = 'data-auth-token';
const ATTR_DONE = 'data-chart-rendered';
const activeCharts = new WeakMap<HTMLElement, () => void>();
const renderVersions = new WeakMap<HTMLElement, symbol>();

declare global {
  interface Window {
    CHARTSDK_API_BASE?: string;
  }
}

// API 베이스 우선순위: 명시 설정 > sdk.js 스크립트 출처 > 현재 페이지 출처
function resolveApiBase(): string {
  if (window.CHARTSDK_API_BASE) return window.CHARTSDK_API_BASE;
  const script = document.currentScript as HTMLScriptElement | null;
  if (script?.src) return new URL(script.src).origin;
  return window.location.origin;
}

const apiBase = resolveApiBase();

function cleanupActiveChart(el: HTMLElement): void {
  const cleanup = activeCharts.get(el);
  if (!cleanup) return;
  activeCharts.delete(el);
  cleanup();
}

function clearError(el: HTMLElement): void {
  if (!el.hasAttribute('data-chart-error')) return;
  el.removeAttribute('data-chart-error');
  el.innerHTML = '';
}

/** 명령형 단일 렌더 — SPA 등 DOM 스캔 타이밍이 어긋나는 환경 대응 */
export async function render(el: HTMLElement, opts: { chartId: string; token: string }): Promise<void> {
  const version = Symbol();
  renderVersions.set(el, version);
  cleanupActiveChart(el);
  clearError(el);

  try {
    const response = await fetchChartOption(apiBase, opts.chartId, opts.token);
    const { option, computedAt } = response;
    const sampling = normalizeSampling(response);
    if (renderVersions.get(el) !== version) return;
    // 지도 차트면 GeoJSON 을 먼저 등록(1회 캐시). 비-지도 차트는 즉시 통과.
    await ensureMapsRegistered(apiBase, option);
    if (renderVersions.get(el) !== version) return;
    const cleanup = renderChart(el, option, computedAt, sampling);
    activeCharts.set(el, cleanup);
  } catch {
    if (renderVersions.get(el) !== version) return;
    renderError(el);
  }
}

/** SPA 언마운트 또는 명령형 재구성 시 차트와 관찰자를 명시적으로 해제한다. */
export function dispose(el: HTMLElement): void {
  renderVersions.delete(el);
  cleanupActiveChart(el);
  clearError(el);
  el.removeAttribute(ATTR_DONE);
}

/** 선언형 자동 스캔 — [data-chart-id] 를 찾아 렌더 (중복 렌더 방지) */
export function scan(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[${ATTR_ID}]`)) {
    if (el.hasAttribute(ATTR_DONE)) continue;
    const chartId = el.getAttribute(ATTR_ID);
    const token = el.getAttribute(ATTR_TOKEN);
    if (!chartId || !token) continue;
    el.setAttribute(ATTR_DONE, '');
    void render(el, { chartId, token });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }
}
