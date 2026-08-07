import { describe, expect, it } from 'vitest';
import {
  MAJOR_TYPES,
  OPTION_REGISTRY,
  defaultsFor,
  getPath,
  getVariants,
  setPath,
  type MajorType,
  type OptionDef,
  type Options,
} from '@chartsdk/chart-options';
import type { QueryResult } from './api/types';
import { assembleOption } from '../mocks/mockTransform';
import { tooltipFieldsFor } from '@chartsdk/chart-options/tooltip';

const EXTERNAL_OR_COMPOSITE_KEYS = new Set([
  'chartType',
  'description',
  'display.preset',
  'display.width',
  'display.height',
  'palettePreset',
  'colorMap',
  'refreshMode',
  'refreshNow',
]);

const RESULTS: Record<MajorType, QueryResult> = {
  bar: result(
    [{ name: 'category', type: 'text' }, { name: 's1', type: 'number' }, { name: 's2', type: 'number' }],
    [['B', 20, 10], ['A', 10, 30]],
  ),
  line: result(
    [{ name: 'date', type: 'date' }, { name: 's1', type: 'number' }, { name: 's2', type: 'number' }],
    [['2026-02-01', 20, 10], ['2026-01-01', 10, 30], ['2026-03-01', 30, 20]],
  ),
  pie: result(
    [{ name: 'category', type: 'text' }, { name: 's1', type: 'number' }],
    [['B', 20], ['A', 10]],
  ),
  scatter: result(
    [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'size', type: 'number' }],
    [[2, 20, 9], [1, 10, 3]],
  ),
  boxplot: result(
    [{ name: 'category', type: 'text' }, { name: 's1', type: 'number' }],
    [['B', 20], ['A', 1], ['A', 2], ['A', 3], ['A', 4], ['A', 100]],
  ),
  heatmap: result(
    [{ name: 'category', type: 'text' }, { name: 's1', type: 'number' }, { name: 's2', type: 'number' }],
    [['B', 20, 10], ['A', 10, 30]],
  ),
  map: result(
    [
      { name: '__chartsdk_area_name', type: 'text' },
      { name: '__chartsdk_area_value', type: 'number' },
      { name: '__chartsdk_longitude', type: 'number' },
      { name: '__chartsdk_latitude', type: 'number' },
      { name: '__chartsdk_point_name', type: 'text' },
      { name: '__chartsdk_point_value', type: 'number' },
      { name: '__chartsdk_size', type: 'number' },
      { name: '__chartsdk_series', type: 'text' },
    ],
    [
      ['서울', 20, 127.0, 37.5, '서울 점', 20, 9, '국내'],
      ['부산', 10, 129.1, 35.2, '부산 점', 10, 3, '해외'],
    ],
  ),
  geoscatter: result(
    [
      { name: '__chartsdk_longitude', type: 'number' },
      { name: '__chartsdk_latitude', type: 'number' },
      { name: '__chartsdk_point_name', type: 'text' },
      { name: '__chartsdk_point_value', type: 'number' },
      { name: '__chartsdk_size', type: 'number' },
      { name: '__chartsdk_series', type: 'text' },
    ],
    [
      [127.1, 37.5, '서울 점', 20, 9, '국내'],
      [126.9, 35.2, '부산 점', 10, 3, '해외'],
    ],
  ),
};

function result(columns: QueryResult['columns'], rows: QueryResult['rows']): QueryResult {
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 0 };
}

function preparedOptions(chartType: MajorType, key: string): Options {
  const options = defaultsFor(chartType);
  options.title = 'Audit title';
  options.legend = { ...options.legend, show: true };
  options.tooltip = {
    ...options.tooltip,
    enabled: true,
    trigger: 'axis',
  };
  options.emphasis = {
    ...options.emphasis,
    enabled: true,
    colorMode: 'custom',
    color: '#123456',
    scale: true,
  };
  options.dataLabel = true;
  options.refreshMode = 'cache';
  options.xAxis = {
    ...options.xAxis,
    title: 'X title',
    titleLocation: 'middle',
    labelIntervalMode: 'step',
    labelEvery: 2,
    scale: 'value',
    tickMode: 'auto',
  };
  options.yAxis = {
    ...options.yAxis,
    title: 'Y title',
    titleLocation: 'middle',
    labelIntervalMode: 'step',
    labelEvery: 2,
    rangeMode: 'manual',
    min: 0,
    max: 100,
    scale: 'value',
    tickMode: 'auto',
  };

  if (key === 'emphasis.colorMode') options.emphasis.colorMode = 'auto';
  if (key === 'emphasis.color') options.emphasis.colorMode = 'custom';
  if (key === 'emphasis.scaleSize') options.emphasis.scale = true;
  if (key === 'legend.scroll') options.legend.position = 'left';
  if (key === 'xAxis.labelEvery') options.xAxis.labelIntervalMode = 'step';
  if (key === 'yAxis.labelEvery') options.yAxis.labelIntervalMode = 'step';
  if (key === 'yAxis.hideOverlap') options.yAxis.labelIntervalMode = 'auto';
  if (key === 'xAxis.splitNumber') options.xAxis.tickMode = 'auto';
  if (key === 'xAxis.interval') options.xAxis.tickMode = 'fixed';
  if (key === 'xAxis.minInterval' || key === 'xAxis.maxInterval') options.xAxis.tickMode = 'auto';
  if (key === 'xAxis.includeZero') {
    options.xAxis.scale = 'value';
    options.xAxis.tickMode = 'fixed';
  }
  if (key === 'xAxis.logBase') options.xAxis.scale = 'log';
  if (key === 'yAxis.splitNumber') options.yAxis.tickMode = 'auto';
  if (key === 'yAxis.interval') options.yAxis.tickMode = 'fixed';
  if (key === 'yAxis.includeZero') {
    options.yAxis.scale = 'value';
    options.yAxis.tickMode = 'fixed';
  }
  if (key === 'yAxis.logBase') options.yAxis.scale = 'log';
  if (key === 'bar.normalize') options.variant = 'stacked';
  if (key === 'line.areaOpacity') options.variant = 'area';
  if (key === 'line.symbolSize') options.line.showSymbol = true;
  if (key === 'pie.donutWidth') options.variant = 'donut';
  if (key === 'scatter.symbolSize') options.variant = 'scatter';
  if (key === 'scatter.bubbleField') options.variant = 'bubble';
  if (key === 'variant' && chartType === 'scatter') options.scatter.bubbleField = 'size';
  if (key.startsWith('map.heatmap')) options.variant = 'heatmap';
  if (key.startsWith('geoscatter.showEffect')
    || key.startsWith('geoscatter.ripple')) options.variant = 'effectScatter';
  return options;
}

function changedValue(definition: OptionDef, chartType: MajorType, current: unknown): unknown {
  if (definition.key === 'variant') {
    return getVariants(chartType).find((variant) => variant.value !== current)?.value;
  }
  if (definition.key === 'seriesTypes') {
    return { s1: chartType === 'bar' ? 'line' : 'bar' };
  }
  if (definition.key === 'analysis.boxplotOutliers') {
    return { show: false, color: '#123456' };
  }
  if (definition.key === 'analysis.movingAverage') {
    return { enabled: true, seriesIndex: 0, period: 2, showInLegend: true };
  }
  if (definition.key === 'analysis.annotations') {
    return {
      lines: [{ name: 'limit', value: 15, color: '#123456', lineType: 'dashed' }],
      ranges: [],
      targets: [],
    };
  }
  if (definition.key === 'scatter.bubbleField') return 'size';
  if (definition.key === 'map.viewport') {
    return {
      mode: 'coordinates',
      bounds: { west: 126, east: 130, south: 34, north: 38 },
    };
  }
  if (definition.key === 'tooltip.fields') {
    const descriptor = tooltipFieldsFor({
      chartType,
      columns: RESULTS[chartType].columns,
      options: preparedOptions(chartType, definition.key),
    })[0];
    return descriptor ? { [descriptor.key]: !descriptor.defaultVisible } : { unavailable: false };
  }
  if (definition.control === 'toggle') return current !== true;
  if (definition.control === 'text' || definition.control === 'textarea') {
    return current === 'Audit value' ? 'Changed value' : 'Audit value';
  }
  if (definition.control === 'color') return current === '#123456' ? '#654321' : '#123456';
  if (definition.control === 'palette') return ['#123456', '#654321', '#ABCDEF'];
  if (definition.control === 'select' || definition.control === 'segment') {
    return definition.choices?.find((choice) => choice.value !== current)?.value;
  }
  if (definition.control === 'number' || definition.control === 'slider') {
    if (current == null) return definition.min ?? 1;
    const numeric = Number(current);
    const step = definition.step ?? 1;
    const increased = numeric + step;
    return definition.max == null || increased <= definition.max
      ? increased
      : Math.max(definition.min ?? 0, numeric - step);
  }
  return undefined;
}

describe('옵션 레지스트리 렌더 효과', () => {
  it('렌더 옵션은 적용 대상 8종에서 실제 ECharts 출력 또는 런타임 메타데이터를 바꾼다', () => {
    const noEffect: string[] = [];
    const noMutation: string[] = [];

    for (const chartType of MAJOR_TYPES) {
      for (const definition of OPTION_REGISTRY) {
        if (!definition.appliesTo.includes(chartType)) continue;
        if ((definition.storage ?? 'jsonb') !== 'jsonb') continue;
        if (definition.echarts === '@none' || EXTERNAL_OR_COMPOSITE_KEYS.has(definition.key)) continue;
        if (definition.key === 'variant' && getVariants(chartType).length <= 1) continue;

        const beforeOptions = preparedOptions(chartType, definition.key);
        const afterOptions = structuredClone(beforeOptions);
        const current = getPath(beforeOptions, definition.key);
        const changed = changedValue(definition, chartType, current);
        if (changed === undefined || Object.is(changed, current)) {
          noMutation.push(`${chartType}:${definition.key}`);
          continue;
        }
        setPath(afterOptions, definition.key, changed);
        const before = assembleOption(RESULTS[chartType], chartType, beforeOptions);
        const after = assembleOption(RESULTS[chartType], chartType, afterOptions);
        if (JSON.stringify(before) === JSON.stringify(after)) noEffect.push(`${chartType}:${definition.key}`);
      }
    }

    expect(noMutation).toEqual([]);
    expect(noEffect).toEqual([]);
  });
});
