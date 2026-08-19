// 임베드 데이터 조회 (API 계약 1) — 서버가 조립한 ECharts option 을 그대로 받는다.
// SDK 는 모양을 결정하지 않는다(방식 A): 받은 option 을 setOption 만 한다.
// 요청에는 chartId 가 없다 — 서빙할 차트는 임베드 키에 서버측으로 바인딩되어 있다(계약 6.1).
import type { SamplingMetadata } from '@chartsdk/chart-options/sampling';

export interface ChartDataResponse {
  chartId: number;
  computedAt: string;
  rowCount?: number;
  truncated?: boolean;
  sampling?: SamplingMetadata;
  approximate?: boolean;
  sampleRate?: number;
  option: Record<string, unknown>;
}

/**
 * 클라이언트 요청 백스톱(ms) — 임베드 데이터 요청 계약값.
 *
 * 서버의 "정상적으로 느린" 최악 경로는 단계별 상한의 합성이다(값은 모두 server `application.yml`
 * 기본값 기준이며 각 단계는 한 요청 안에서 순차로 이어질 수 있다):
 *
 *   refresh single-flight 대기 막바지에 lease 획득   ~35s  (chartsdk.refresh.wait-seconds)
 *   + sample-cache 빌드 대기 막바지에 lease 획득      ~35s  (chartsdk.sampling-cache.build-wait-seconds)
 *   + 표본 쿼리                                       ~30s  (chartsdk.query.timeout.sample-seconds)
 *   + 본(chart/federation) 쿼리                       ~30s  (chartsdk.query.timeout.*-seconds)
 *   ≈ 130s
 *
 * 따라서 백스톱은 130s 보다 커야 캐시 없는 live 차트 같은 정상 요청을 오탐 실패시키지 않는다.
 * 이 상한은 서버·네트워크가 아예 응답하지 않아 로딩 placeholder 가 영구 방치되는 경우에만 걸리는
 * 안전장치다(정상 UX 는 서버가 35s 안에 503 REFRESH_IN_PROGRESS 등으로 정리한다).
 * 서버 timeout 환경변수를 바꿨다면 임베드 쪽도 `resolveEmbedTimeoutMs` 의 재정의 계약
 * (전역 `CHARTSDK_TIMEOUT_MS` 또는 script[data-timeout-ms])으로 함께 맞춘다.
 */
export const EMBED_REQUEST_TIMEOUT_MS = 150_000;
/** 정적 GeoJSON 자산은 장시간 DB 계산 경로가 아니므로 빠르게 실패하고 재시도할 수 있게 분리한다. */
export const EMBED_MAP_REQUEST_TIMEOUT_MS = 15_000;

/**
 * 배포 환경별 timeout 재정의 — 전역 `CHARTSDK_TIMEOUT_MS` > script[data-timeout-ms] > 기본값.
 * 서버 timeout 설정을 튜닝한 운영자가 SDK 재빌드 없이 임베드 deadline 을 연동하기 위한 계약이다.
 * 유효하지 않은 값(음수·0·숫자 아님)은 무시하고 다음 후보로 넘어간다.
 */
export function resolveEmbedTimeoutMs(
  script: { dataset?: { timeoutMs?: string } } | null,
  globalOverride?: unknown,
): number {
  for (const raw of [globalOverride, script?.dataset?.timeoutMs]) {
    if (raw == null || raw === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return EMBED_REQUEST_TIMEOUT_MS;
}

/** 지도 자산 timeout 재정의 — 전역 `CHARTSDK_MAP_TIMEOUT_MS` > script[data-map-timeout-ms] > 15초. */
export function resolveEmbedMapTimeoutMs(
  script: { dataset?: { mapTimeoutMs?: string } } | null,
  globalOverride?: unknown,
): number {
  for (const raw of [globalOverride, script?.dataset?.mapTimeoutMs]) {
    if (raw == null || raw === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return EMBED_MAP_REQUEST_TIMEOUT_MS;
}

// 요청 타임아웃: 서버가 응답하지 않고 매달리면(hang) 컨테이너가 로딩 상태로 영구 방치되므로
// 상한을 두고 abort 한다. abort 는 fetch reject 로 이어져 index 의 renderError 경로로 합류한다.
// AbortController+setTimeout(수동)로 구현해 AbortSignal.timeout 미지원 브라우저까지 커버한다.
export async function fetchChartOption(
  apiBase: string,
  embedKey: string,
  timeoutMs = EMBED_REQUEST_TIMEOUT_MS,
): Promise<ChartDataResponse> {
  const url = `${apiBase}/api/v1/charts/data`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      // 로그인 콘솔과 같은 origin에 임베드되더라도 관리 세션 쿠키를 절대 전송하지 않는다.
      credentials: 'omit',
      headers: { Authorization: `Bearer ${embedKey}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`차트 데이터 요청 실패: ${res.status}`);
    return (await res.json()) as ChartDataResponse;
  } finally {
    clearTimeout(timer);
  }
}
