import { describe, expect, it } from 'vitest';
import contractCases from '@chartsdk/chart-options/layout-contract-cases.json';
import samplingCases from '@chartsdk/chart-options/sampling-contract-cases.json';
import type { BuilderConfig, ChartType, QueryResult } from './api/types';
import { assembleOption, buildAggregateRows, buildGeneratedSql } from '../mocks/mockTransform';

type LayoutContractCase = {
  name: string;
  chartType: ChartType;
  options: Record<string, unknown>;
  expected: Record<string, unknown>;
  absent?: string[];
};

const result: QueryResult = {
  columns: [
    { name: 'category', type: 'text' },
    { name: 's1', type: 'number' },
    { name: 's2', type: 'number' },
  ],
  rows: [['A', 10, 30], ['B', 20, 20]],
  rowCount: 2,
  truncated: false,
  elapsedMs: 0,
};

function valueAt(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (Array.isArray(value)) return value[Number(key)];
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, root);
}

describe('mock 변환기 레이아웃 계약', () => {
  it.each(contractCases as LayoutContractCase[])('$name', ({ chartType, options, expected, absent = [] }) => {
    const option = assembleOption(result, chartType, options);
    for (const [path, value] of Object.entries(expected)) expect(valueAt(option, path), path).toEqual(value);
    for (const path of absent) expect(valueAt(option, path), path).toBeUndefined();
  });
});

describe('mock 변환기 표본 집계 계약', () => {
  it.each(samplingCases)('$name', ({ agg, rate, sampledValue, expectedValue, extrapolated }) => {
    expect(sampledValue).toBe(expectedValue);
    expect(extrapolated).toBe(false);

    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [],
      xAxis: 'category',
      xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: agg as BuilderConfig['yAxis'][number]['agg'] }],
      where: [],
      orderBy: null,
      sample: { rate },
    };
    const sql = buildGeneratedSql(config);
    expect(sql).toContain('TABLESAMPLE SYSTEM');
    expect(sql).toContain('REPEATABLE (48291)');
    expect(sql).toContain('__chartsdk_sample_count');
    expect(sql).not.toContain(`* (100.0 / ${rate})`);
  });

  it('표본 결과에 정식 sampling 객체와 레거시 별칭을 함께 반환한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [],
      xAxis: 'category',
      xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: 'sum' }],
      where: [],
      orderBy: null,
      sample: { rate: 10 },
    };
    const sampled = buildAggregateRows(config, 'bar');
    expect(sampled.sampling).toMatchObject({
      version: 5,
      approximate: true,
      method: 'SYSTEM',
      mode: 'manual',
      rate: 10,
      seed: 48_291,
      valueMode: 'sample',
      sampledRowCount: 2_850,
      estimates: [{ series: 'sum_amount', aggregate: 'sum', treatment: 'SAMPLE_AGGREGATE' }],
      warnings: ['BLOCK_SAMPLE_CLUSTERING', 'SAMPLE_AGGREGATE_ONLY'],
    });
    expect(sampled.sampling?.groups).toHaveLength(sampled.rows.length);
    expect(sampled.approximate).toBe(true);
    expect(sampled.sampleRate).toBe(10);
  });

  it('100%는 TABLESAMPLE 없이 정확 실행하고 approximate=false로 반환한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' }, joins: [], xAxis: 'category', xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: 'variance' }], where: [], orderBy: null,
      sample: { mode: 'manual', rate: 100, seed: 7 },
    };
    expect(buildGeneratedSql(config)).not.toMatch(/TABLESAMPLE|REPEATABLE|__chartsdk_sample|100\.0 \/ 100/);
    const result = buildAggregateRows(config, 'bar');
    expect(result.sampling).toEqual({
      version: 5, mode: 'manual', requestedMethod: 'auto', approximate: false, method: 'FULL_SCAN', rate: 100,
      valueMode: 'exact', estimates: [{ series: 'variance_amount', aggregate: 'variance', treatment: 'EXACT' }],
    });
    expect(result.approximate).toBe(false);
  });

  it('INDEX_RANDOM 표준편차는 서버 v5와 같은 그룹별 95% 구간·정규성 경고를 반환한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' }, joins: [], xAxis: 'category', xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: 'stddev' }], where: [], orderBy: null,
      sample: { mode: 'manual', size: 10_000, seed: 48_291 },
    };

    const result = buildAggregateRows(config, 'bar');

    expect(result.sampling).toMatchObject({
      version: 5,
      method: 'INDEX_RANDOM',
      populationEstimate: 500_000_000,
      sampleSize: 10_000,
      confidenceLevel: 0.95,
      warnings: ['INDEX_RANDOM_SAMPLE', 'STDDEV_CI_NORMALITY_ASSUMED'],
      estimates: [{ aggregate: 'stddev', relativeErrorPct: 16.2 }],
    });
    expect(result.sampling?.rate).toBeUndefined();
    expect(result.sampleRate).toBe(0.1); // 레거시 별칭만 서버와 같은 최소 표시 비율로 유지
    expect(result.sampling?.estimates?.[0]?.intervals).toHaveLength(result.rows.length);
    expect(result.sampling?.estimates?.[0]?.intervals?.[0]).toMatchObject({
      sampleCount: 2_000, estimate: 10, lower95: 8.78, upper95: 11.62,
    });
  });

  it('MIN/MAX와 고유 개수는 외삽하지 않고 용도별 경고를 반환한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' }, joins: [], xAxis: 'category', xAxisBucket: null,
      yAxis: [
        { column: 'amount', agg: 'min' },
        { column: 'amount', agg: 'max' },
        { column: 'customer_id', agg: 'count_distinct' },
      ],
      where: [], orderBy: null, sample: { mode: 'manual', rate: 0.5, seed: 12 },
    };
    const sql = buildGeneratedSql(config);
    expect(sql).toContain('TABLESAMPLE SYSTEM (0.5) REPEATABLE (12)');
    expect(sql).not.toContain('100.0 / 0.5');
    expect(buildAggregateRows(config, 'bar').sampling?.warnings).toEqual([
      'BLOCK_SAMPLE_CLUSTERING', 'OBSERVED_EXTREME_ONLY', 'DISTINCT_COUNT_NOT_EXTRAPOLATED',
    ]);
  });
});
