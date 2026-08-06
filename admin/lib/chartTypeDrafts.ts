import {
  optionsWithDefaults,
  switchMajor,
  type MajorType,
  type Options,
} from '@chartsdk/chart-options';
import type { BuilderConfig, GeoSeriesType } from '@/lib/api';
import { normalizeBuilderForChartType } from '@/lib/builder';

const SHARED_OPTION_KEYS = ['description', 'refreshMode', 'cacheTtlSeconds'] as const;

export interface ChartDataBindingDraft {
  xAxis: BuilderConfig['xAxis'];
  xAxisBucket: BuilderConfig['xAxisBucket'];
  seriesBy: BuilderConfig['seriesBy'];
  seriesOrder: BuilderConfig['seriesOrder'];
  yAxis: BuilderConfig['yAxis'];
  orderBy: BuilderConfig['orderBy'];
  geoSeriesType: BuilderConfig['geoSeriesType'];
  geoPoint: BuilderConfig['geoPoint'];
  geoArea: BuilderConfig['geoArea'];
  fieldDisplayNames: BuilderConfig['fieldDisplayNames'];
}

interface StoredChartDataBindingDraft {
  sourceFingerprint: string;
  binding: ChartDataBindingDraft;
}

export interface ChartTypeDraftStore {
  optionsByType: Partial<Record<MajorType, Options>>;
  dataByContract: Record<string, StoredChartDataBindingDraft>;
}

export interface ChartTypeTransition {
  builder: BuilderConfig;
  options: Options;
  restoredDataDraft: boolean;
  restoredOptionsDraft: boolean;
}

export function createChartTypeDraftStore(): ChartTypeDraftStore {
  return { optionsByType: {}, dataByContract: {} };
}

/** 원본·JOIN 계약이 바뀌면 축 참조를 재사용할 수 없다. 조건·표본은 의도적으로 제외한다. */
export function chartSourceFingerprint(builder: BuilderConfig): string {
  return JSON.stringify({ table: builder.table ?? null, joins: builder.joins ?? [] });
}

/** 원본·JOIN 변경 시 데이터 바인딩만 폐기하고 차트별 시각화 옵션은 보존한다. */
export function clearChartDataDrafts(store: ChartTypeDraftStore): ChartTypeDraftStore {
  return { ...store, dataByContract: {} };
}

/** 현재 차트의 시각화 옵션과 데이터 바인딩을 독립적인 깊은 복사본으로 저장한다. */
export function captureChartTypeDraft(
  store: ChartTypeDraftStore,
  chartType: MajorType,
  builder: BuilderConfig,
  options: Options,
): ChartTypeDraftStore {
  return {
    optionsByType: {
      ...store.optionsByType,
      [chartType]: visualOptionsSnapshot(options),
    },
    dataByContract: captureDataBinding(store.dataByContract, chartType, builder, options),
  };
}

/** 같은 대분류 안에서 데이터 계약이 바뀌는 지도 중분류 전환용 캡처 경로다. */
export function captureChartDataDraft(
  store: ChartTypeDraftStore,
  chartType: MajorType,
  builder: BuilderConfig,
  options: Options,
): ChartTypeDraftStore {
  return {
    ...store,
    dataByContract: captureDataBinding(store.dataByContract, chartType, builder, options),
  };
}

/**
 * 대분류 전환을 계산한다.
 * - 재방문: 저장된 시각화 옵션·축 바인딩 복원
 * - 최초 방문/원본 계약 불일치: 기존 정규화 규칙으로 안전한 초기 상태 생성
 * - table/joins/where/sample/limit는 현재 Builder에서 유지
 */
export function resolveChartTypeTransition(
  store: ChartTypeDraftStore,
  from: MajorType,
  to: MajorType,
  currentBuilder: BuilderConfig,
  currentOptions: Options,
): ChartTypeTransition {
  const optionDraft = store.optionsByType[to];
  const nextOptions = optionDraft
    ? restoreVisualOptions(optionDraft, currentOptions, to)
    : switchMajor(currentOptions, from, to).next;
  const dataResolution = resolveChartDataDraft(store, to, currentBuilder, nextOptions);

  return {
    builder: dataResolution.builder,
    options: nextOptions,
    restoredDataDraft: dataResolution.restored,
    restoredOptionsDraft: optionDraft != null,
  };
}

/** 지도 영역↔히트맵처럼 같은 대분류 안에서 variant가 데이터 역할을 바꾸는 경우에 사용한다. */
export function resolveChartDataForOptions(
  store: ChartTypeDraftStore,
  chartType: MajorType,
  currentBuilder: BuilderConfig,
  nextOptions: Options,
): { builder: BuilderConfig; restored: boolean } {
  return resolveChartDataDraft(store, chartType, currentBuilder, nextOptions);
}

function captureDataBinding(
  current: ChartTypeDraftStore['dataByContract'],
  chartType: MajorType,
  builder: BuilderConfig,
  options: Options,
): ChartTypeDraftStore['dataByContract'] {
  return {
    ...current,
    [chartDataContractKey(chartType, options)]: {
      sourceFingerprint: chartSourceFingerprint(builder),
      binding: extractDataBinding(builder),
    },
  };
}

function resolveChartDataDraft(
  store: ChartTypeDraftStore,
  chartType: MajorType,
  currentBuilder: BuilderConfig,
  options: Options,
): { builder: BuilderConfig; restored: boolean } {
  const stored = store.dataByContract[chartDataContractKey(chartType, options)];
  const compatible = stored?.sourceFingerprint === chartSourceFingerprint(currentBuilder);
  const candidate = compatible
    ? restoreDataBinding(currentBuilder, stored.binding)
    : currentBuilder;
  const geoSeriesType = geoSeriesTypeForOptions(chartType, options);
  const seeded = geoSeriesType ? { ...candidate, geoSeriesType } : candidate;

  return {
    builder: normalizeBuilderForChartType(seeded, chartType),
    restored: compatible,
  };
}

function chartDataContractKey(chartType: MajorType, options: Options): string {
  if (chartType === 'map') return `map:${options.variant === 'heatmap' ? 'heatmap' : 'map'}`;
  return chartType;
}

function geoSeriesTypeForOptions(chartType: MajorType, options: Options): GeoSeriesType | undefined {
  if (chartType === 'map') return options.variant === 'heatmap' ? 'heatmap' : 'map';
  if (chartType === 'geoscatter') return options.variant === 'effectScatter' ? 'effectScatter' : 'scatter';
  return undefined;
}

function extractDataBinding(builder: BuilderConfig): ChartDataBindingDraft {
  return structuredClone({
    xAxis: builder.xAxis,
    xAxisBucket: builder.xAxisBucket,
    seriesBy: builder.seriesBy,
    seriesOrder: builder.seriesOrder,
    yAxis: builder.yAxis,
    orderBy: builder.orderBy,
    geoSeriesType: builder.geoSeriesType,
    geoPoint: builder.geoPoint,
    geoArea: builder.geoArea,
    fieldDisplayNames: builder.fieldDisplayNames,
  });
}

function restoreDataBinding(
  currentBuilder: BuilderConfig,
  draft: ChartDataBindingDraft,
): BuilderConfig {
  const restored = structuredClone(draft);
  const fieldDisplayNames = {
    ...(currentBuilder.fieldDisplayNames ?? {}),
    ...(restored.fieldDisplayNames ?? {}),
  };
  return {
    ...currentBuilder,
    ...restored,
    ...(Object.keys(fieldDisplayNames).length > 0
      ? { fieldDisplayNames }
      : { fieldDisplayNames: undefined }),
  };
}

function visualOptionsSnapshot(options: Options): Options {
  const snapshot = structuredClone(options);
  for (const key of SHARED_OPTION_KEYS) delete snapshot[key];
  return snapshot;
}

function restoreVisualOptions(snapshot: Options, currentOptions: Options, chartType: MajorType): Options {
  const restored = optionsWithDefaults(chartType, structuredClone(snapshot));
  for (const key of SHARED_OPTION_KEYS) {
    if (currentOptions[key] === undefined) delete restored[key];
    else restored[key] = structuredClone(currentOptions[key]);
  }
  return restored;
}
