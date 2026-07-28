export const BOXPLOT_OUTLIER_SERIES_ID = '__chartsdk_boxplot_outliers';
export const MOVING_AVERAGE_SERIES_ID = '__chartsdk_moving_average';

export const MIN_MOVING_AVERAGE_PERIOD = 2;
export const MAX_MOVING_AVERAGE_PERIOD = 100;

export interface BoxplotOutlierOptions {
  show: boolean;
  color: string;
}

export interface MovingAverageOptions {
  enabled: boolean;
  /** 결과의 값 계열 인덱스(0부터). */
  seriesIndex: number;
  /** 현재 시점을 포함해 평균에 사용할 연속 관측치 수. */
  period: number;
  showInLegend: boolean;
}

export const DEFAULT_BOXPLOT_OUTLIERS: BoxplotOutlierOptions = {
  show: true,
  color: '#D81B60',
};

export const DEFAULT_MOVING_AVERAGE: MovingAverageOptions = {
  enabled: false,
  seriesIndex: 0,
  period: 3,
  showInLegend: true,
};

export function boxplotOutliersOf(value: unknown): BoxplotOutlierOptions {
  const source = objectOf(value);
  return {
    show: source.show !== false,
    color: normalizeColor(source.color, DEFAULT_BOXPLOT_OUTLIERS.color),
  };
}

export function movingAverageOf(value: unknown): MovingAverageOptions {
  const source = objectOf(value);
  return {
    enabled: source.enabled === true,
    seriesIndex: nonNegativeInteger(source.seriesIndex, DEFAULT_MOVING_AVERAGE.seriesIndex),
    period: clampInteger(
      source.period,
      MIN_MOVING_AVERAGE_PERIOD,
      MAX_MOVING_AVERAGE_PERIOD,
      DEFAULT_MOVING_AVERAGE.period,
    ),
    showInLegend: source.showInLegend !== false,
  };
}

/**
 * 변환기가 `sortOrder` 대신 시간 오름차순을 강제하는 조건.
 * 서버 `ChartOptionConverter.convert()` 의 movingAverageEligible 과 동일해야 하며,
 * MSW 변환기와 편집기 잠금 표시가 이 함수 하나를 공유한다.
 * 값 컬럼이 없어 평균 계열을 만들지 못하는 경우에도 정렬은 이미 덮이므로 여기서 걸러내지 않는다.
 */
export function movingAverageOverridesSort(
  chartType: string,
  options: unknown,
  columns: readonly { type?: unknown }[] | null | undefined,
): boolean {
  if (chartType !== 'line') return false;
  const analysis = objectOf(objectOf(options).analysis);
  return movingAverageOf(analysis.movingAverage).enabled
    && isTemporalColumnType(columns?.[0]?.type);
}

/** JDBC·PostgreSQL·MSW가 노출하는 날짜/시간 타입명을 모두 허용한다. */
export function isTemporalColumnType(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  const normalized = type.toLowerCase();
  return normalized.includes('date') || normalized.includes('time');
}

function objectOf(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toUpperCase()
    : fallback;
}
