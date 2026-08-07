import { describe, expect, it } from 'vitest';
import { defaultsFor, MAJOR_TYPES, type Options } from '@chartsdk/chart-options';
import type { BuilderConfig } from '@/lib/api';
import { normalizeBuilderForChartType } from './builder';
import {
  captureChartDataDraft,
  captureChartTypeDraft,
  chartSourceFingerprint,
  clearChartDataDrafts,
  createChartTypeDraftStore,
  resolveChartDataForOptions,
  resolveChartTypeTransition,
} from './chartTypeDrafts';

const barBuilder = (overrides: Partial<BuilderConfig> = {}): BuilderConfig => ({
  table: { datasourceId: 1, schema: 'public', name: 'sales' },
  joins: [],
  xAxis: 'category',
  xAxisBucket: null,
  seriesBy: null,
  seriesOrder: 'asc',
  yAxis: [
    { column: 'amount', agg: 'sum', alias: '매출' },
    { column: 'id', agg: 'count', alias: '건수' },
  ],
  where: [{ column: 'status', op: 'eq', value: 'paid' }],
  orderBy: { target: 'y1', direction: 'desc' },
  sample: { mode: 'manual', size: 5_000, seed: 7 },
  ...overrides,
});

describe('차트 종류별 편집 초안', () => {
  it('막대→원형→막대 왕복에서 막대 데이터와 시각화 옵션을 정확히 복원한다', () => {
    const bar = barBuilder();
    const barOptions = {
      ...defaultsFor('bar'),
      description: '공통 설명',
      refreshMode: 'manual',
      bar: { width: 62, gap: 18 },
      title: '막대 제목',
    } as Options;
    let store = captureChartTypeDraft(createChartTypeDraftStore(), 'bar', bar, barOptions);

    const pieFirst = resolveChartTypeTransition(store, 'bar', 'pie', bar, barOptions);
    expect(pieFirst.restoredDataDraft).toBe(false);
    expect(pieFirst.builder.yAxis).toHaveLength(1);

    const pieBuilder = {
      ...pieFirst.builder,
      where: [{ column: 'status', op: 'eq', value: 'refunded' }],
      sample: { mode: 'manual', size: 2_000, seed: 11 },
    } satisfies BuilderConfig;
    const pieOptions = {
      ...pieFirst.options,
      description: '원형에서 바꾼 공통 설명',
      pie: { donutWidth: 45 },
      title: '원형 제목',
    } as Options;
    store = captureChartTypeDraft(store, 'pie', pieBuilder, pieOptions);

    const restored = resolveChartTypeTransition(store, 'pie', 'bar', pieBuilder, pieOptions);
    expect(restored.restoredDataDraft).toBe(true);
    expect(restored.restoredOptionsDraft).toBe(true);
    expect(restored.builder.yAxis).toEqual(bar.yAxis);
    expect(restored.builder.orderBy).toEqual(bar.orderBy);
    expect(restored.builder.where).toEqual(pieBuilder.where);
    expect(restored.builder.sample).toEqual(pieBuilder.sample);
    expect(restored.options.bar).toMatchObject({ width: 62, gap: 18 });
    expect(restored.options.title).toBe('막대 제목');
    expect(restored.options.description).toBe('원형에서 바꾼 공통 설명');
    expect(restored.options.refreshMode).toBe('manual');
  });

  it('여러 차트를 방문해도 종류별 마지막 데이터와 옵션을 각각 유지한다', () => {
    const source = barBuilder();
    let store = createChartTypeDraftStore();
    store = captureChartTypeDraft(store, 'bar', source, { ...defaultsFor('bar'), title: '막대' });
    store = captureChartTypeDraft(store, 'line', {
      ...source,
      yAxis: [{ column: 'amount', agg: 'avg', alias: '평균' }],
    }, { ...defaultsFor('line'), title: '선', line: { width: 5 } });
    store = captureChartTypeDraft(store, 'pie', {
      ...source,
      yAxis: [{ column: 'id', agg: 'count', alias: '개수' }],
    }, { ...defaultsFor('pie'), title: '원형', pie: { donutWidth: 35 } });

    const line = resolveChartTypeTransition(store, 'pie', 'line', source, defaultsFor('pie'));
    const pie = resolveChartTypeTransition(store, 'line', 'pie', source, defaultsFor('line'));
    const bar = resolveChartTypeTransition(store, 'pie', 'bar', source, defaultsFor('pie'));

    expect(line.builder.yAxis).toEqual([{ column: 'amount', agg: 'avg', alias: '평균' }]);
    expect(line.options.title).toBe('선');
    expect(pie.builder.yAxis).toEqual([{ column: 'id', agg: 'count', alias: '개수' }]);
    expect(pie.options.title).toBe('원형');
    expect(bar.builder.yAxis).toEqual(source.yAxis);
    expect(bar.options.title).toBe('막대');
  });

  it('지원하는 8개 대분류의 마지막 초안을 모두 독립적으로 복원한다', () => {
    const source = barBuilder();
    let store = createChartTypeDraftStore();

    for (const type of MAJOR_TYPES) {
      const normalized = normalizeBuilderForChartType(source, type);
      const typed = {
        ...normalized,
        yAxis: normalized.yAxis.map((field, index) => ({
          ...field,
          alias: `${type}-값-${index}`,
        })),
      };
      store = captureChartTypeDraft(
        store,
        type,
        typed,
        { ...defaultsFor(type), title: `${type}-옵션` },
      );
    }

    for (const type of MAJOR_TYPES) {
      const restored = resolveChartTypeTransition(store, 'bar', type, source, defaultsFor('bar'));
      expect(restored.restoredDataDraft, type).toBe(true);
      expect(restored.restoredOptionsDraft, type).toBe(true);
      expect(restored.options.title, type).toBe(`${type}-옵션`);
      expect(restored.builder.yAxis[0]?.alias, type).toBe(`${type}-값-0`);
    }
  });

  it('원본·JOIN 변경으로 데이터 초안을 비워도 차트별 옵션은 보존한다', () => {
    const source = barBuilder();
    const options = { ...defaultsFor('bar'), title: '기억할 제목', bar: { width: 70 } } as Options;
    const captured = captureChartTypeDraft(createChartTypeDraftStore(), 'bar', source, options);
    const cleared = clearChartDataDrafts(captured);
    const current = barBuilder({
      table: { datasourceId: 1, schema: 'public', name: 'orders' },
      xAxis: 'created_at',
      yAxis: [{ column: 'total', agg: 'sum' }],
    });
    const restored = resolveChartTypeTransition(cleared, 'pie', 'bar', current, defaultsFor('pie'));

    expect(cleared.dataByContract).toEqual({});
    expect(restored.restoredDataDraft).toBe(false);
    expect(restored.builder.table).toEqual(current.table);
    expect(restored.builder.xAxis).toBe('created_at');
    expect(restored.options.title).toBe('기억할 제목');
    expect(restored.options.bar).toMatchObject({ width: 70 });
  });

  it('원본 지문은 조건·표본을 제외하고 테이블·JOIN 변경만 감지한다', () => {
    const source = barBuilder();
    expect(chartSourceFingerprint({
      ...source,
      where: [],
      sample: null,
    })).toBe(chartSourceFingerprint(source));
    expect(chartSourceFingerprint({
      ...source,
      joins: [{
        table: { datasourceId: 1, schema: 'public', name: 'customers' },
        type: 'left',
        on: { leftColumn: 'sales.customer_id', rightColumn: 'customers.id' },
      }],
    })).not.toBe(chartSourceFingerprint(source));
  });

  it('캡처한 배열과 중첩 옵션은 이후 현재 상태 변경에 오염되지 않는다', () => {
    const builder = barBuilder();
    const options = { ...defaultsFor('bar'), bar: { width: 55 } } as Options;
    const store = captureChartTypeDraft(createChartTypeDraftStore(), 'bar', builder, options);

    builder.yAxis[0].alias = '변경됨';
    (options.bar as Record<string, unknown>).width = 10;

    const restored = resolveChartTypeTransition(store, 'pie', 'bar', barBuilder(), defaultsFor('pie'));
    expect(restored.builder.yAxis[0].alias).toBe('매출');
    expect(restored.options.bar).toMatchObject({ width: 55 });
  });

  it('지도 영역과 지도 히트맵의 데이터 바인딩을 서로 독립적으로 복원한다', () => {
    const areaOptions = { ...defaultsFor('map'), variant: 'map' } as Options;
    const heatmapOptions = { ...defaultsFor('map'), variant: 'heatmap' } as Options;
    const area = barBuilder({
      yAxis: [{ column: 'amount', agg: 'sum' }],
      geoSeriesType: 'map',
      geoArea: { mode: 'spatial', spatialColumn: 'boundary', nameColumn: 'region', valueColumn: 'amount' },
    });
    let store = captureChartDataDraft(createChartTypeDraftStore(), 'map', area, areaOptions);

    const heatmapFirst = resolveChartDataForOptions(store, 'map', area, heatmapOptions);
    const heatmap = {
      ...heatmapFirst.builder,
      xAxis: 'longitude',
      yAxis: [{ column: 'latitude', agg: 'none' }],
      geoPoint: { mode: 'columns', nameColumn: 'store', valueColumn: 'amount' },
    } satisfies BuilderConfig;
    store = captureChartDataDraft(store, 'map', heatmap, heatmapOptions);

    const restoredArea = resolveChartDataForOptions(store, 'map', heatmap, areaOptions);
    const restoredHeatmap = resolveChartDataForOptions(store, 'map', restoredArea.builder, heatmapOptions);

    expect(restoredArea.restored).toBe(true);
    expect(restoredArea.builder.geoArea).toEqual(area.geoArea);
    expect(restoredArea.builder.geoPoint).toBeUndefined();
    expect(restoredHeatmap.restored).toBe(true);
    expect(restoredHeatmap.builder.xAxis).toBe('longitude');
    expect(restoredHeatmap.builder.geoPoint).toMatchObject(heatmap.geoPoint!);
  });
});
