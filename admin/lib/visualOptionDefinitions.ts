import {
  visibleDefs,
  type MajorType,
  type OptionDef,
  type Options,
} from '@chartsdk/chart-options';

const CHART_BUILDER_OPTION_KEYS = new Set(['chartType', 'variant']);

/** 차트 종류는 구성 탭이 소유하고, 시각화 옵션에는 표현 관련 정의만 남긴다. */
export function visualOptionDefinitions(chartType: MajorType, options: Options): OptionDef[] {
  return visibleDefs(chartType, options).filter(
    (definition) => !CHART_BUILDER_OPTION_KEYS.has(definition.key),
  );
}
