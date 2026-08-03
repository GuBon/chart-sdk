/** server API·Admin·SDK가 공유하는 표본 설정·실행 결과 계약(v7 — 결과집합 Bernoulli 행 표본 포함). */
export const SAMPLING_CONTRACT_VERSION = 7;
export const MIN_SAMPLE_RATE = 0.1;
export const MAX_SAMPLE_RATE = 100;
export const DEFAULT_SAMPLE_SEED = 48_291;

// 무편향 표본은 목표 갯수(size)가 정확도를 결정한다. RESULT_RANDOM의 실측치는 Bernoulli라 목표와 달라질 수 있다.
export const DEFAULT_SAMPLE_SIZE = 10_000;
export const MIN_SAMPLE_SIZE = 1_000;
export const MAX_SAMPLE_SIZE = 50_000;
export const FULL_SCAN_ROWS = 100_000;

export type SamplingMode = 'auto' | 'manual';
export type SamplingRequestedMethod = 'auto' | 'system';
export type SamplingMethod = 'INDEX_RANDOM' | 'RESULT_RANDOM' | 'SYSTEM' | 'FULL_SCAN';
export type SamplingValueMode = 'sample' | 'population_estimate' | 'exact'; // population_estimate는 v4 이하 읽기 호환
export type SamplingWarningCode =
  | 'BLOCK_SAMPLE_CLUSTERING'
  | 'INDEX_RANDOM_SAMPLE'
  | 'RESULT_RANDOM_SAMPLE'
  | 'RESULT_POPULATION_ESTIMATE_UNAVAILABLE'
  | 'INDEX_SAMPLE_ESTIMATED_TOTAL'
  | 'SMALL_SAMPLE_GROUPS'
  | 'STDDEV_CI_NORMALITY_ASSUMED'
  | 'SAMPLE_AGGREGATE_ONLY'
  | 'OBSERVED_EXTREME_ONLY'
  | 'DISTINCT_COUNT_NOT_EXTRAPOLATED';
export type SamplingTreatment =
  | 'ROW_SAMPLE'
  | 'SAMPLE_AGGREGATE'
  | 'EXTRAPOLATED_TOTAL'
  | 'SAMPLE_ESTIMATE'
  | 'OBSERVED_EXTREME'
  | 'OBSERVED_DISTINCT'
  | 'EXACT';

export interface SamplingEstimate {
  series: string;
  aggregate: string;
  treatment: SamplingTreatment;
  warning?: SamplingWarningCode;
  marginOfError?: number;
  relativeErrorPct?: number;
  intervals?: SamplingConfidenceInterval[];
}

export interface SamplingConfidenceInterval {
  key: unknown;
  sampleCount: number;
  estimate: number;
  lower95: number;
  upper95: number;
  relativeErrorPct?: number;
}

export interface SamplingGroupCount {
  key: unknown;
  sampleCount: number;
}

export interface SamplingMetadata {
  version: number;
  // 스펙
  mode: SamplingMode;
  requestedMethod: SamplingRequestedMethod;
  rate?: number;
  sizeTarget?: number;
  seed?: number;
  // 실행
  approximate: boolean;
  method: SamplingMethod;
  valueMode: SamplingValueMode;
  populationEstimate?: number;
  sampleSize?: number; // 실행 목표. RESULT_RANDOM의 가변 실측치는 sampledRowCount.
  sampledRowCount?: number;
  confidenceLevel?: number;
  groups?: SamplingGroupCount[];
  estimates?: SamplingEstimate[];
  warnings?: SamplingWarningCode[];
}

type SamplingSource = {
  sampling?: Partial<SamplingMetadata> | null;
  approximate?: boolean;
  sampleRate?: number;
};

/** 소수 1자리 비율로 정규화한다. 100은 전체 정확 실행을 뜻한다. */
export function normalizeSampleRate(rate: number): number {
  if (!Number.isFinite(rate)) return MIN_SAMPLE_RATE;
  return Math.max(MIN_SAMPLE_RATE, Math.min(MAX_SAMPLE_RATE, Math.round(rate * 10) / 10));
}

/** 갯수를 [MIN, MAX] 로 정규화. */
export function normalizeSampleSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SAMPLE_SIZE;
  return Math.max(MIN_SAMPLE_SIZE, Math.min(MAX_SAMPLE_SIZE, Math.round(size)));
}

/** 전체 추정 행수가 이 값 이하면 서버가 전량 정확 계산으로 폴백한다(표본 불필요). */
export function isFullScanTable(estimatedRowCount?: number | null): boolean {
  return typeof estimatedRowCount === 'number' && estimatedRowCount > 0 && estimatedRowCount <= FULL_SCAN_ROWS;
}

export function samplingTreatment(aggregate: string, approximate: boolean): SamplingTreatment {
  if (!approximate) return 'EXACT';
  if (aggregate === 'none') return 'ROW_SAMPLE';
  if (aggregate === 'sum' || aggregate === 'count') return 'SAMPLE_AGGREGATE';
  if (aggregate === 'min' || aggregate === 'max') return 'OBSERVED_EXTREME';
  if (aggregate === 'count_distinct') return 'OBSERVED_DISTINCT';
  return 'SAMPLE_ESTIMATE';
}

export function samplingWarningForAggregate(aggregate: string): SamplingWarningCode | undefined {
  if (aggregate === 'sum' || aggregate === 'count') return 'SAMPLE_AGGREGATE_ONLY';
  if (aggregate === 'min' || aggregate === 'max') return 'OBSERVED_EXTREME_ONLY';
  if (aggregate === 'count_distinct') return 'DISTINCT_COUNT_NOT_EXTRAPOLATED';
  return undefined;
}

export function samplingWarningMessage(code: SamplingWarningCode): string {
  switch (code) {
    case 'BLOCK_SAMPLE_CLUSTERING':
      return '블록 표본 결과입니다. 데이터의 물리적 정렬·군집에 따라 전체 분포와 다를 수 있습니다.';
    case 'INDEX_RANDOM_SAMPLE':
      return '전체 데이터에서 무작위로 선택된 행의 표본 결과입니다.';
    case 'RESULT_RANDOM_SAMPLE':
      return '조회 결과의 각 행을 같은 확률로 독립 선택한 Bernoulli 표본입니다. 실제 행 수는 목표와 다를 수 있습니다.';
    case 'RESULT_POPULATION_ESTIMATE_UNAVAILABLE':
      return '조회 결과 행 수를 추정하지 못해 Bernoulli 확률을 100%로 적용했습니다.';
    case 'INDEX_SAMPLE_ESTIMATED_TOTAL':
      return '이 결과는 이전 계약에서 만든 전체 추정값입니다. 최신 sampling v7로 다시 계산하는 것을 권장합니다.';
    case 'SMALL_SAMPLE_GROUPS':
      return '표본이 30개 미만인 항목은 오차범위를 산출하지 않았습니다. 표본 크기를 늘리면 정확도가 올라갑니다.';
    case 'STDDEV_CI_NORMALITY_ASSUMED':
      return '표준편차·분산의 95% 추정 구간은 각 그룹의 값이 정규분포에 가깝다는 가정으로 계산했습니다.';
    case 'SAMPLE_AGGREGATE_ONLY':
      return 'SUM·COUNT는 선택된 표본의 합계·개수이며 전체 데이터의 합계·개수가 아닙니다.';
    case 'OBSERVED_EXTREME_ONLY':
      return 'MIN·MAX는 표본에서 관측된 극값이며 전체 데이터의 실제 최솟값·최댓값을 보장하지 않습니다.';
    case 'DISTINCT_COUNT_NOT_EXTRAPOLATED':
      return '고유 개수는 단순 외삽하지 않은 표본 관측값이며 전체 고유 개수보다 작을 수 있습니다.';
  }
}

/** 표본 방식 라벨 — Admin·SDK 배지 문구 이원화 방지. */
export function samplingMethodLabel(method: SamplingMethod): string {
  switch (method) {
    case 'INDEX_RANDOM':
      return '무작위 행 표본';
    case 'RESULT_RANDOM':
      return '결과 Bernoulli 행 표본';
    case 'SYSTEM':
      return '블록 표본';
    case 'FULL_SCAN':
      return '전체';
  }
}

/** "95% 신뢰수준 · 오차 약 ±X%" — 오차범위가 있는 시리즈들의 상대오차 최댓값. 없으면 undefined. */
export function confidenceBadgeText(sampling: SamplingMetadata): string | undefined {
  if (!sampling.approximate || !sampling.confidenceLevel) return undefined;
  const rels = (sampling.estimates ?? [])
    .map((e) => e.relativeErrorPct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!rels.length) return undefined;
  const level = Math.round(sampling.confidenceLevel * 100);
  return `${level}% 신뢰수준 · 오차 약 ±${Math.max(...rels).toFixed(1)}%`;
}

/** nested sampling 우선, 레거시 approximate/sampleRate 응답도 같은 읽기 모델로 승격한다. */
export function normalizeSampling(source: SamplingSource): SamplingMetadata | undefined {
  const nested = source.sampling;
  const approximate = nested?.approximate ?? source.approximate;
  if (typeof approximate !== 'boolean') return undefined;

  const exact = approximate === false;
  const method: SamplingMethod = (nested?.method as SamplingMethod) ?? (exact ? 'FULL_SCAN' : 'SYSTEM');
  if (exact ? method !== 'FULL_SCAN' : method !== 'SYSTEM' && method !== 'INDEX_RANDOM' && method !== 'RESULT_RANDOM') return undefined;

  // 정식 nested 계약이 있으면 그 안의 스펙만 신뢰한다. top-level sampleRate는 nested 자체가 없는 레거시 응답에만 사용한다.
  const rateSource = nested ? nested.rate : source.sampleRate;
  const metadata: SamplingMetadata = {
    version: nested?.version ?? SAMPLING_CONTRACT_VERSION,
    mode: nested?.mode === 'auto' ? 'auto' : 'manual',
    requestedMethod: nested?.requestedMethod === 'system' ? 'system' : 'auto',
    approximate,
    method,
    valueMode: exact ? 'exact' : nested?.valueMode === 'population_estimate' ? 'population_estimate' : 'sample',
  };
  if (typeof rateSource === 'number' && Number.isFinite(rateSource)) metadata.rate = normalizeSampleRate(rateSource);
  if (typeof nested?.sizeTarget === 'number') metadata.sizeTarget = nested.sizeTarget;
  if (!exact && typeof nested?.seed === 'number' && Number.isFinite(nested.seed)) metadata.seed = nested.seed;
  if (typeof nested?.populationEstimate === 'number') metadata.populationEstimate = nested.populationEstimate;
  if (typeof nested?.sampleSize === 'number') metadata.sampleSize = nested.sampleSize;
  if (typeof nested?.sampledRowCount === 'number' && nested.sampledRowCount >= 0) metadata.sampledRowCount = nested.sampledRowCount;
  if (typeof nested?.confidenceLevel === 'number') metadata.confidenceLevel = nested.confidenceLevel;
  if (Array.isArray(nested?.groups)) metadata.groups = nested.groups as SamplingGroupCount[];
  if (Array.isArray(nested?.estimates)) metadata.estimates = nested.estimates as SamplingEstimate[];
  if (Array.isArray(nested?.warnings)) metadata.warnings = nested.warnings as SamplingWarningCode[];
  return metadata;
}
