import { describe, expect, it } from 'vitest';
import contractCases from '@chartsdk/chart-options/layout-contract-cases.json';
import samplingCases from '@chartsdk/chart-options/sampling-contract-cases.json';
import type { BuilderConfig, ChartType, QueryResult } from './api/types';
import { assembleOption, buildAggregateRows, buildGeneratedSql } from '../mocks/mockTransform';
import { SAMPLING_CONTRACT_VERSION } from '@chartsdk/chart-options/sampling';

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
  it('지도 포인트 SQL은 조건에 맞는 좌표를 전부 반환하고 일반 원본 차트 제한은 유지한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [],
      xAxis: 'amount',
      xAxisBucket: null,
      yAxis: [{ column: 'id', agg: 'none' }],
      where: [{ column: 'amount', op: 'gte', value: 126 }],
      orderBy: null,
    };

    expect(buildGeneratedSql(config, 'geoscatter')).toContain('WHERE "amount" >= ?');
    expect(buildGeneratedSql(config, 'geoscatter')).not.toContain('LIMIT 1000');
    expect(buildGeneratedSql(config, 'scatter')).not.toContain('LIMIT 1000');
  });

  it('공간 Point 지도 포인트 SQL은 WGS84 경도·위도와 선택 크기값으로 투영한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [], xAxis: null, xAxisBucket: null, yAxis: [],
      where: [{ column: 'dept', op: 'eq', value: '영업' }], orderBy: null,
      geoPoint: { mode: 'spatial', spatialColumn: 'location', sizeColumn: 'amount' },
    };

    const sql = buildGeneratedSql(config, 'geoscatter');
    expect(sql).toContain('ST_X(ST_Transform(("location")::geometry, 4326)) AS "__chartsdk_longitude"');
    expect(sql).toContain('ST_Y(ST_Transform(("location")::geometry, 4326)) AS "__chartsdk_latitude"');
    expect(sql).toContain('"amount" AS "__chartsdk_size"');
    expect(sql).toContain('WHERE "dept" = ? AND "location" IS NOT NULL');
    expect(sql).not.toContain('LIMIT 1000');
    expect(buildAggregateRows(config, 'geoscatter').columns).toHaveLength(3);
  });

  it('공간 Polygon 지도 SQL과 미리보기 option은 동적 GeoJSON 경계를 전달한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [], xAxis: null, xAxisBucket: null, yAxis: [],
      where: [{ column: 'amount', op: 'gt', value: 0 }], orderBy: null,
      geoArea: { mode: 'spatial', spatialColumn: 'service_area', nameColumn: 'category', valueColumn: 'amount' },
    };

    const sql = buildGeneratedSql(config, 'map');
    expect(sql).toContain('ST_AsGeoJSON(ST_Transform(("service_area")::geometry, 4326), 6) AS "__chartsdk_geojson"');
    expect(sql).toContain('CAST("category" AS text) AS "__chartsdk_area_name"');
    expect(sql).toContain('WHERE "amount" > ? AND "service_area" IS NOT NULL');
    expect(sql).not.toContain('LIMIT 1000');

    const rows = buildAggregateRows(config, 'map');
    const option = assembleOption(rows, 'map', {});
    const series = (option.series as Array<Record<string, unknown>>)[0];
    expect(series.map).toMatch(/^chartsdk-dynamic-mock-/);
    expect((option.__chartsdkMaps as unknown[])).toHaveLength(1);
  });

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
      version: SAMPLING_CONTRACT_VERSION,
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
      version: SAMPLING_CONTRACT_VERSION, mode: 'manual', requestedMethod: 'auto', approximate: false, method: 'FULL_SCAN', rate: 100,
      valueMode: 'exact', estimates: [{ series: 'variance_amount', aggregate: 'variance', treatment: 'EXACT' }],
    });
    expect(result.approximate).toBe(false);
  });

  it('INDEX_RANDOM 표준편차는 서버 v6와 같은 그룹별 95% 구간·정규성 경고를 반환한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' }, joins: [], xAxis: 'category', xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: 'stddev' }], where: [], orderBy: null,
      sample: { mode: 'manual', size: 10_000, seed: 48_291 },
    };

    const result = buildAggregateRows(config, 'bar');

    expect(result.sampling).toMatchObject({
      version: SAMPLING_CONTRACT_VERSION,
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

  it('조인·WHERE 결과를 모집단 CTE로 만든 뒤 집계 전에 RESULT_RANDOM 표본을 뽑는다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'public', name: 'sales' },
      joins: [{
        table: { datasourceId: 1, schema: 'public', name: 'orders' },
        type: 'left',
        on: { leftColumn: 'sales.id', rightColumn: 'orders.sale_id' },
      }],
      xAxis: 'sales.category',
      xAxisBucket: null,
      yAxis: [{ column: 'orders.amount', agg: 'avg', alias: 'average' }],
      where: [{ column: 'orders.amount', op: 'gt', value: 0 }],
      orderBy: null,
      sample: { mode: 'manual', size: 12_000, seed: 321 },
    };

    const sql = buildGeneratedSql(config);
    expect(sql).toContain('"__chartsdk_population" AS (SELECT');
    expect(sql).toContain('LEFT JOIN "orders" ON "sales"."id" = "orders"."sale_id"');
    expect(sql).toContain('WHERE "orders"."amount" > ?)');
    expect(sql).toContain('ORDER BY random() LIMIT 12000');
    expect(sql.indexOf('LEFT JOIN')).toBeLessThan(sql.indexOf('ORDER BY random()'));
    expect(sql).toContain('AVG("__chartsdk_sample"."__chartsdk_y_0") AS "average"');

    expect(buildAggregateRows(config, 'bar').sampling).toMatchObject({
      version: SAMPLING_CONTRACT_VERSION,
      method: 'RESULT_RANDOM',
      sampleSize: 12_000,
      sampledRowCount: 12_000,
      confidenceLevel: 0.95,
      warnings: ['RESULT_RANDOM_SAMPLE'],
    });
  });

  it('일반 VIEW는 TABLESAMPLE 대신 조회 결과 행 표본을 사용한다', () => {
    const config: BuilderConfig = {
      table: { datasourceId: 1, schema: 'analytics', name: 'sales_summary' },
      joins: [], xAxis: 'category', xAxisBucket: null,
      yAxis: [{ column: 'amount', agg: 'sum' }], where: [], orderBy: null,
      sample: { mode: 'auto', seed: 9 },
    };

    expect(buildGeneratedSql(config)).toContain('FROM "analytics"."sales_summary"');
    expect(buildGeneratedSql(config)).toContain('"__chartsdk_population" AS');
    expect(buildGeneratedSql(config)).not.toContain('TABLESAMPLE');
    expect(buildAggregateRows(config, 'bar').sampling).toMatchObject({
      method: 'RESULT_RANDOM', warnings: ['RESULT_RANDOM_SAMPLE', 'SAMPLE_AGGREGATE_ONLY'],
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

describe('계열 피벗·색상 계약', () => {
  const config: BuilderConfig = {
    table: { datasourceId: 1, schema: 'public', name: 'regional_population' },
    joins: [], xAxis: 'region', xAxisBucket: null, seriesBy: 'year', seriesOrder: 'asc',
    yAxis: [{ column: 'population', agg: 'sum' }], where: [], orderBy: null, sample: null,
  };

  it('연도를 결과 시리즈 컬럼으로 즉시 전개한다', () => {
    const pivoted = buildAggregateRows(config, 'bar');
    expect(pivoted.columns.map((column) => column.name)).toEqual(['region', '2012', '2013', '2014', '2015']);
    expect(pivoted.rows).toHaveLength(5);
    expect(buildGeneratedSql(config, 'bar')).toContain('GROUP BY "region", "year"');
  });

  it('CARTO Safe를 기본으로 쓰고 12개 초과 색을 반복하지 않는다', () => {
    const many: QueryResult = {
      columns: [{ name: 'region', type: 'text' }, ...Array.from({ length: 14 }, (_, i) => ({ name: `s${i}`, type: 'number' }))],
      rows: [['서울', ...Array.from({ length: 14 }, (_, i) => i)]], rowCount: 1, truncated: false, elapsedMs: 0,
    };
    const option = assembleOption(many, 'bar', {});
    const colors = Object.values(option.__chartsdkAutoColorMap as Record<string, string>);
    expect(colors).toHaveLength(14);
    expect(new Set(colors).size).toBe(14);
    expect(colors[0]).toBe('#88CCEE');
    expect(colors[12]).not.toBe(colors[0]);
  });
});

describe('순차형 visualMap 색상 계약', () => {
  it.each(['map', 'heatmap'] as const)('%s는 새 테마의 7단계 전체를 낮은 값부터 사용한다', (chartType) => {
    const option = assembleOption(result, chartType, optionsWithDefaults(chartType));
    const colors = ((option.visualMap as Record<string, any>).inRange as Record<string, any>).color;

    expect(colors).toEqual(cartoPalette('teal'));
  });

  it.each(['map', 'heatmap'] as const)('%s 색상 방향을 반전한다', (chartType) => {
    const options = optionsWithDefaults(chartType);
    options.paletteReversed = true;
    options.colorTheme.sequentialReversed = true;
    const option = assembleOption(result, chartType, options);
    const colors = ((option.visualMap as Record<string, any>).inRange as Record<string, any>).color;

    expect(colors).toEqual([...cartoPalette('teal')].reverse());
  });

  it('구 저장 지도는 기존 2색 visualMap 출력을 유지한다', () => {
    const legacy = optionsWithDefaults('map', {
      palettePreset: 'safe',
      palette: cartoPalette('safe'),
    });
    const option = assembleOption(result, 'map', legacy);
    const colors = ((option.visualMap as Record<string, any>).inRange as Record<string, any>).color;

    expect(colors).toEqual(['#f7f7f7', '#88CCEE']);
  });
});

describe('개별 데이터 색상 계약', () => {
  it('막대 하나만 data itemStyle로 덮어쓴다', () => {
    const option = assembleOption(result, 'bar', {
      itemColorOverrides: [{
        kind: 'cartesian',
        seriesName: 's1',
        dimensions: ['B'],
        occurrence: 0,
        color: '#FFB000',
      }],
    });
    const series = (option.series as Array<Record<string, any>>)[0];

    expect(series.data[0]).toBe(10);
    expect(series.data[1]).toEqual({ value: 20, itemStyle: { color: '#FFB000' } });
  });

  it('선의 점 색상만 바꾸고 선 전체 색상은 유지한다', () => {
    const option = assembleOption(result, 'line', {
      colorMap: { s1: '#112233' },
      itemColorOverrides: [{
        kind: 'cartesian',
        seriesName: 's1',
        dimensions: ['A'],
        occurrence: 0,
        color: '#FFB000',
      }],
    });
    const series = (option.series as Array<Record<string, any>>)[0];

    expect(series.lineStyle.color).toBe('#112233');
    expect(series.data[0].itemStyle.color).toBe('#FFB000');
  });

  it('분산형 점은 x·y 값으로 식별해 색을 덮어쓴다', () => {
    const scatterResult: QueryResult = {
      columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }],
      rows: [[5, 10], [5, 20]],
      rowCount: 2,
      truncated: false,
      elapsedMs: 0,
    };
    const option = assembleOption(scatterResult, 'scatter', {
      itemColorOverrides: [{
        kind: 'scatter',
        seriesName: 'y',
        dimensions: [5, 20],
        occurrence: 0,
        color: '#FFB000',
      }],
    });
    const data = (option.series as Array<Record<string, any>>)[0].data;

    expect(data[0]).toEqual([5, 10]);
    expect(data[1]).toEqual({ value: [5, 20], itemStyle: { color: '#FFB000' } });
  });

  it('지도 지역 하나만 visualMap 위에 areaColor를 지정한다', () => {
    const mapResult: QueryResult = {
      columns: [{ name: 'region', type: 'text' }, { name: 'value', type: 'number' }],
      rows: [['서울특별시', 10], ['부산광역시', 20]],
      rowCount: 2,
      truncated: false,
      elapsedMs: 0,
    };
    const option = assembleOption(mapResult, 'map', {
      itemColorOverrides: [{
        kind: 'map',
        seriesName: '__map__',
        dimensions: ['부산광역시'],
        occurrence: 0,
        color: '#FFB000',
      }],
    });
    const data = (option.series as Array<Record<string, any>>)[0].data;

    expect(data[0].itemStyle).toBeUndefined();
    expect(data[1].itemStyle.areaColor).toBe('#FFB000');
    expect(option.visualMap).toBeDefined();
  });
});
