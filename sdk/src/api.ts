// 임베드 데이터 조회 (API 계약 1) — 서버가 조립한 ECharts option 을 그대로 받는다.
// SDK 는 모양을 결정하지 않는다(방식 A): 받은 option 을 setOption 만 한다.
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

export async function fetchChartOption(
  apiBase: string,
  chartId: string,
  token: string,
): Promise<ChartDataResponse> {
  const url = `${apiBase}/api/v1/charts/data?chartId=${encodeURIComponent(chartId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`chart ${chartId} 요청 실패: ${res.status}`);
  return (await res.json()) as ChartDataResponse;
}
