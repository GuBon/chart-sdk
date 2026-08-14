import { fetchChartOption, resolveEmbedMapTimeoutMs, resolveEmbedTimeoutMs } from './api';
import { renderChart, renderError, renderEmpty, renderLoading } from './chart';
import { ensureMapsRegistered } from './geo';
import { normalizeSampling } from '@chartsdk/chart-options/sampling';
import { ensureChartWebFonts } from '@chartsdk/chart-options/webFonts';

// 임베드 슬롯은 (사용자, 차트)에 묶인 불투명 임베드 키만 노출한다 — chartId 는 임베드 코드에 넣지 않는다.
const ATTR_KEY = 'data-embed-key';
const ATTR_DONE = 'data-chart-rendered';
const activeCharts = new WeakMap<HTMLElement, () => void>();
const renderVersions = new WeakMap<HTMLElement, symbol>();

declare global {
  interface Window {
    CHARTSDK_API_BASE?: string;
    /** 요청 백스톱(ms) 재정의 — 서버 timeout 설정을 튜닝한 배포 환경용(resolveEmbedTimeoutMs). */
    CHARTSDK_TIMEOUT_MS?: number;
    /** 정적 GeoJSON 요청 백스톱(ms). 데이터 쿼리 timeout과 독립적이다. */
    CHARTSDK_MAP_TIMEOUT_MS?: number;
  }
}

const sdkScript = document.currentScript as HTMLScriptElement | null;

// API 베이스 우선순위: 전역 명시 설정 > script[data-api-base] > sdk.js 출처 > 현재 페이지 출처.
// SDK 자산과 API 서버가 서로 다른 출처여도 복사한 스니펫만으로 동작하도록 script 속성을 정식 계약으로 둔다.
function resolveApiBase(): string {
  if (window.CHARTSDK_API_BASE) return window.CHARTSDK_API_BASE;
  if (sdkScript?.dataset.apiBase) return sdkScript.dataset.apiBase.replace(/\/+$/, '');
  if (sdkScript?.src) return new URL(sdkScript.src).origin;
  return window.location.origin;
}

function resolveAssetBase(): string {
  if (sdkScript?.src) return new URL('.', sdkScript.src).href;
  return `${window.location.origin}/`;
}

const apiBase = resolveApiBase();
const assetBase = resolveAssetBase();

// 렌더 시점마다 해석 — SPA 호스트가 스크립트 로드 이후에 전역 재정의를 설정해도 반영되도록.
const requestTimeoutMs = () => resolveEmbedTimeoutMs(sdkScript, window.CHARTSDK_TIMEOUT_MS);
const mapRequestTimeoutMs = () => resolveEmbedMapTimeoutMs(sdkScript, window.CHARTSDK_MAP_TIMEOUT_MS);

function cleanupActiveChart(el: HTMLElement): void {
  const cleanup = activeCharts.get(el);
  if (!cleanup) return;
  activeCharts.delete(el);
  cleanup();
}

function clearPlaceholders(el: HTMLElement): void {
  if (!el.hasAttribute('data-chart-error') && !el.hasAttribute('data-chart-empty')
    && !el.hasAttribute('data-chart-loading')) return;
  el.removeAttribute('data-chart-error');
  el.removeAttribute('data-chart-empty');
  el.removeAttribute('data-chart-loading');
  el.innerHTML = '';
}

/** 명령형 단일 렌더 — SPA 등 DOM 스캔 타이밍이 어긋나는 환경 대응 */
export async function render(el: HTMLElement, opts: { embedKey: string }): Promise<void> {
  const version = Symbol();
  renderVersions.set(el, version);
  cleanupActiveChart(el);
  // 데이터 도착 전 로딩 상태를 즉시 표시 — 응답 지연/타임아웃 구간의 "빈 박스"를 없앤다.
  renderLoading(el);

  try {
    const timeoutMs = requestTimeoutMs();
    const response = await fetchChartOption(apiBase, opts.embedKey, timeoutMs);
    const { option, computedAt, rowCount } = response;
    const sampling = normalizeSampling(response);
    if (renderVersions.get(el) !== version) return;
    // 결과 0행은 오류가 아니라 "표시할 데이터 없음" — 빈 차트를 그리지 않고 안내 placeholder 로 끝낸다.
    if (rowCount === 0) {
      renderEmpty(el);
      return;
    }
    // 지도 차트면 GeoJSON 을 먼저 등록(1회 캐시). 비-지도 차트는 즉시 통과.
    await ensureMapsRegistered(apiBase, option, mapRequestTimeoutMs());
    if (renderVersions.get(el) !== version) return;
    await ensureChartWebFonts(option, assetBase);
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
  clearPlaceholders(el);
  el.removeAttribute(ATTR_DONE);
}

/** 선언형 자동 스캔 — [data-embed-key] 를 찾아 렌더 (중복 렌더 방지) */
export function scan(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[${ATTR_KEY}]`)) {
    if (el.hasAttribute(ATTR_DONE)) continue;
    const embedKey = el.getAttribute(ATTR_KEY);
    if (!embedKey) continue;
    el.setAttribute(ATTR_DONE, '');
    void render(el, { embedKey });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }
}
