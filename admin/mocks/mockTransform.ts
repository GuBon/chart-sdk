// ⚠ MSW 목 전용 — 프로덕션 변환기는 서버 단일(Java). 여기 로직은 server 구현 전까지
// 미리보기를 채우기 위한 스탠드인이며, 변환기 매핑 스펙(변환기_매핑스펙_차트옵션.md)의 MVP 부분만 모사한다.
// (프론트 코드가 아니라 가짜 백엔드 자리이므로 "이중 변환기 금지" 원칙과 충돌하지 않는다.)
import type { BuilderConfig, ChartType, QueryResult, SchemaTable } from '@/lib/api';
import {
  DEFAULT_SAMPLE_SEED,
  DEFAULT_SAMPLE_SIZE,
  FULL_SCAN_ROWS,
  normalizeSampleSize,
  SAMPLING_CONTRACT_VERSION,
  normalizeSampleRate,
  samplingTreatment,
  samplingWarningForAggregate,
  type SamplingMetadata,
  type SamplingWarningCode,
} from '@chartsdk/chart-options/sampling';
import {
  resolveChartFontFamilies,
  resolveChartLayoutMetrics,
  resolveChartTitleText,
  resolveChartTypography,
} from '@chartsdk/chart-options/display';
import { EMBEDDED_MAPS_KEY, MAP_VIEWPORT_KEY } from '@chartsdk/chart-options/geo';
import {
  DEFAULT_PALETTE,
  isPalettePresetForFamily,
  resolveSeriesColorMap,
} from '@chartsdk/chart-options/palettes';
import {
  tooltipFieldsFor,
  visibleTooltipFields,
} from '@chartsdk/chart-options/tooltip';
import {
  AXIS_DISPLAY_NAMES_KEY,
  SERIES_DISPLAY_NAMES_KEY,
  fieldDisplayName,
  measureDisplayName,
  seriesDisplayNames,
} from '@chartsdk/chart-options/fieldDisplayNames';
import {
  itemColorSeriesKey,
  itemColorTargetKey,
  normalizeItemColorOverrides,
  type ItemColorDimension,
  type ItemColorKind,
} from '@chartsdk/chart-options/colorOverrides';
import {
  MAX_ANALYSIS_ANNOTATIONS_PER_KIND,
  analysisAnnotationsOf,
} from '@chartsdk/chart-options/analysisAnnotations';
import {
  BOXPLOT_OUTLIER_SERIES_ID,
  MOVING_AVERAGE_SERIES_ID,
  boxplotOutliersOf,
  isTemporalColumnType,
  movingAverageOf,
  movingAverageOverridesSort,
} from '@chartsdk/chart-options/statisticalOverlays';
import { optionsWithDefaults, type MajorType } from '@chartsdk/chart-options';
import { columnsForBuilder, fieldDisplayNameForRef } from '@/lib/builder';
import { schemaTables } from './seed';

type Cols = { name: string; type: string; displayName?: string }[];
type Rows = unknown[][];

const SAMPLE_CATS = ['의류', '식품', '가전', '도서', '생활'];
const SAMPLE_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
// PostGIS Point 컬럼 선택부터 ECharts geo 좌표 변환까지 화면에서 확인하는 개발용 공간 표본.
// 실제 도시 좌표(경도, 위도)와 점 크기값을 고정해 회귀 테스트가 결정적으로 동작하게 한다.
const SAMPLE_SPATIAL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [126.9780, 37.5665, 95], // 서울
  [129.0756, 35.1796, 82], // 부산
  [128.6014, 35.8714, 70], // 대구
  [126.7052, 37.4563, 76], // 인천
  [126.8526, 35.1595, 58], // 광주
  [127.3845, 36.3504, 64], // 대전
  [129.3114, 35.5384, 55], // 울산
  [127.2890, 36.4800, 45], // 세종
  [127.0286, 37.2636, 88], // 수원
  [127.7298, 37.8813, 41], // 춘천
  [127.4917, 36.6424, 52], // 청주
  [126.5312, 33.4996, 60], // 제주
];

// 동적 Polygon 지도 미리보기용 단순 경계. 실제 서버는 DB 도형을 ST_AsGeoJSON으로 변환한다.
const SAMPLE_SPATIAL_AREAS: ReadonlyArray<readonly [string, number, Record<string, unknown>]> = [
  ['서울 권역', 95, { type: 'Polygon', coordinates: [[[126.76, 37.42], [127.18, 37.42], [127.18, 37.72], [126.76, 37.72], [126.76, 37.42]]] }],
  ['중부 권역', 72, { type: 'Polygon', coordinates: [[[127.15, 36.20], [128.15, 36.20], [128.15, 37.15], [127.15, 37.15], [127.15, 36.20]]] }],
  ['남부 권역', 58, { type: 'MultiPolygon', coordinates: [[[[127.60, 34.70], [129.25, 34.70], [129.25, 35.90], [127.60, 35.90], [127.60, 34.70]]]] }],
];

// 식별자 quote. "table.col" → "table"."col", 단일 "col" → "col" (생성규칙 11.2)
const qident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const qcol = (ref: string) => {
  const i = ref.indexOf('.');
  return i < 0 ? qident(ref) : `${qident(ref.slice(0, i))}.${qident(ref.slice(i + 1))}`;
};
// 테이블 참조 quote. public → "table", 비-public → "schema"."table". 다중 소스면 "ds{id}" 접두(페더레이션 표시).
const qtable = (ref: { datasourceId: number; schema: string; name: string }, multi: boolean) => {
  const base = ref.schema === 'public' ? qident(ref.name) : `${qident(ref.schema)}.${qident(ref.name)}`;
  return multi ? `${qident('ds' + ref.datasourceId)}.${base}` : base;
};
// qualified 컬럼의 표시명(별칭·헤더) — 테이블 접두 제거
const colName = (ref: string) => {
  const i = ref.indexOf('.');
  return i < 0 ? ref : ref.slice(i + 1);
};

// 별칭 자동 생성 (생성규칙 2장) — 조인 시 테이블 접두는 별칭에서 제거
const aliasOf = (y: { column: string; agg: string; alias?: string }) => y.alias || (y.agg === 'none' ? colName(y.column) : `${y.agg}_${colName(y.column)}`);

function whereSql(w: { column: string; op: string; value?: unknown }): string {
  const col = qcol(w.column);
  switch (w.op) {
    case 'eq':
      return `${col} = ?`;
    case 'neq':
      return `${col} <> ?`;
    case 'gt':
      return `${col} > ?`;
    case 'gte':
      return `${col} >= ?`;
    case 'lt':
      return `${col} < ?`;
    case 'lte':
      return `${col} <= ?`;
    case 'contains':
      return `${col} ILIKE '%' || ? || '%'`;
    case 'starts_with':
      return `${col} ILIKE ? || '%'`;
    case 'in': {
      const count = Array.isArray(w.value) && w.value.length > 0 ? w.value.length : 1;
      return `${col} IN (${Array.from({ length: count }, () => '?').join(', ')})`;
    }
    case 'between':
      return `${col} BETWEEN ? AND ?`;
    case 'is_null':
      return `${col} IS NULL`;
    case 'is_not_null':
      return `${col} IS NOT NULL`;
    default:
      return `${col} = ?`;
  }
}

/** 생성된 SQL 문자열(표시용) — 생성규칙 6·7·11장 모사 */
export function buildGeneratedSql(cfg: BuilderConfig, chartType?: ChartType): string {
  const geoSeriesType = cfg.geoSeriesType ?? (chartType === 'map' ? 'map' : chartType === 'geoscatter' ? 'scatter' : undefined);
  const geoPointSeries = chartType === 'geoscatter' || (chartType === 'map' && geoSeriesType === 'heatmap');
  const geoAreaSeries = chartType === 'map' && geoSeriesType === 'map';
  const spatialGeoPoint = geoPointSeries && cfg.geoPoint?.mode === 'spatial';
  const spatialGeoArea = geoAreaSeries && cfg.geoArea?.mode === 'spatial';
  if (!cfg.table) return '';
  // 다중 소스면 페더레이션 → ds 별칭 표기(백엔드 §6 모사).
  const multi = new Set([cfg.table.datasourceId, ...(cfg.joins ?? []).map((j) => j.table.datasourceId)]).size >= 2;
  const where = cfg.where.length ? ` WHERE ${cfg.where.map((w) => whereSql(w)).join(' AND ')}` : '';
  // 조인(11.3) — FROM base 뒤에 joins 순서대로 [INNER|LEFT] JOIN ... ON ...
  const joinSql = (cfg.joins ?? [])
    .map((j) => ` ${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${qtable(j.table, multi)} ON ${qcol(j.on.leftColumn)} = ${qcol(j.on.rightColumn)}`)
    .join('');
  const orderSql = () => {
    if (!cfg.orderBy) return '';
    const pos = cfg.orderBy.target === 'x' ? 1 : Number(cfg.orderBy.target.slice(1)) + (cfg.seriesBy ? 3 : 2);
    return ` ORDER BY ${pos} ${cfg.orderBy.direction.toUpperCase()}`;
  };
  const plan = samplePlanForConfig(cfg);
  const resultRandomSpatialSql = (
    spatialExpression: string,
    projected: string[],
    finalSelects: string[],
  ): string => {
    const population = qident('__chartsdk_population');
    const sample = qident('__chartsdk_sample');
    const spatial = qident('__chartsdk_spatial');
    const sourceAlias = qident('__chartsdk_spatial_source');
    const valueAlias = qident('__chartsdk_spatial_value');
    const sampleSource = `${sample}.${sourceAlias}`;
    const probability = resultBernoulliProbability(plan!);
    const barrier = (cfg.joins?.length ?? 0) > 0 ? ' OFFSET 0' : '';
    const populationSelects = [`${spatialExpression} AS ${sourceAlias}`, ...projected];
    return `WITH ${population} AS (SELECT ${populationSelects.join(', ')}
FROM ${qtable(cfg.table!, multi)}${joinSql}${where}${barrier}),
${sample} AS MATERIALIZED (SELECT ${population}.* FROM ${population} WHERE random() < ${probability}),
${spatial} AS MATERIALIZED (SELECT ST_Transform((${sampleSource})::geometry, 4326) AS ${valueAlias}, ${sample}.* FROM ${sample} WHERE ${sampleSource} IS NOT NULL)
SELECT ${finalSelects.join(', ')}
FROM ${spatial}`;
  };
  const spatialProjectionSql = (selects: string[], nonNullExpression: string): string => {
    const spatialWhere = where
      ? `${where} AND ${nonNullExpression} IS NOT NULL`
      : ` WHERE ${nonNullExpression} IS NOT NULL`;
    if (plan?.approximate && plan.method === 'INDEX_RANDOM') {
      const seed = plan.seed ?? DEFAULT_SAMPLE_SEED;
      const population = Math.max(1, plan.populationEstimate);
      const sample = qident('__chartsdk_sample');
      return `WITH ${qident('__chartsdk_seed')} AS MATERIALIZED (SELECT setseed(${Math.max(-1, Math.min(1, (seed / 2_147_483_647) * 2 - 1))}) AS ${qident('seeded')}),
${qident('__chartsdk_keys')} AS MATERIALIZED (SELECT 1 + floor(random() * ${population})::bigint AS ${qident('v')} FROM ${qident('__chartsdk_seed')} CROSS JOIN generate_series(1, ${plan.sampleSize})),
${sample} AS (SELECT ${qident('__chartsdk_base')}.* FROM ${qident('__chartsdk_keys')} JOIN ${qtable(cfg.table!, multi)} ${qident('__chartsdk_base')} ON ${qident('__chartsdk_base')}.${qident('id')} = ${qident('__chartsdk_keys')}.${qident('v')})
SELECT ${selects.join(', ')}
FROM ${sample}${spatialWhere}`;
    }
    const sampledBase = plan?.approximate && plan.method === 'SYSTEM'
      ? `${qtable(cfg.table!, multi)} TABLESAMPLE SYSTEM (${plan.executionRate}) REPEATABLE (${plan.seed ?? DEFAULT_SAMPLE_SEED})`
      : qtable(cfg.table!, multi);
    return `SELECT ${selects.join(', ')}
FROM ${sampledBase}${joinSql}${spatialWhere}`;
  };
  if (spatialGeoArea) {
    if (!cfg.geoArea?.spatialColumn || !cfg.geoArea.nameColumn || !cfg.geoArea.valueColumn) return '';
    const area = qcol(cfg.geoArea.spatialColumn);
    if (plan?.approximate && plan.method === 'RESULT_RANDOM') {
      const spatial = qident('__chartsdk_spatial');
      const projected = [
        `CAST(${qcol(cfg.geoArea.nameColumn)} AS text) AS ${qident('__chartsdk_area_name')}`,
        `${qcol(cfg.geoArea.valueColumn)} AS ${qident('__chartsdk_area_value')}`,
        ...(cfg.seriesBy ? [`CAST(${qcol(cfg.seriesBy)} AS text) AS ${qident('__chartsdk_series')}`] : []),
      ];
      const finalSelects = [
        `${spatial}.${qident('__chartsdk_area_name')} AS ${qident('__chartsdk_area_name')}`,
        `${spatial}.${qident('__chartsdk_area_value')} AS ${qident('__chartsdk_area_value')}`,
        `ST_AsGeoJSON(${spatial}.${qident('__chartsdk_spatial_value')}, 6) AS ${qident('__chartsdk_geojson')}`,
        ...(cfg.seriesBy ? [`${spatial}.${qident('__chartsdk_series')} AS ${qident('__chartsdk_series')}`] : []),
      ];
      return resultRandomSpatialSql(area, projected, finalSelects);
    }
    const wgs84 = `ST_Transform((${area})::geometry, 4326)`;
    const selects = [
      `CAST(${qcol(cfg.geoArea.nameColumn)} AS text) AS ${qident('__chartsdk_area_name')}`,
      `${qcol(cfg.geoArea.valueColumn)} AS ${qident('__chartsdk_area_value')}`,
      `ST_AsGeoJSON(${wgs84}, 6) AS ${qident('__chartsdk_geojson')}`,
      ...(cfg.seriesBy ? [`CAST(${qcol(cfg.seriesBy)} AS text) AS ${qident('__chartsdk_series')}`] : []),
    ];
    return spatialProjectionSql(selects, area);
  }
  if (spatialGeoPoint) {
    if (!cfg.geoPoint?.spatialColumn) return '';
    const point = qcol(cfg.geoPoint.spatialColumn);
    if (plan?.approximate && plan.method === 'RESULT_RANDOM') {
      const spatial = qident('__chartsdk_spatial');
      const projected = [
        ...(cfg.geoPoint.nameColumn ? [`CAST(${qcol(cfg.geoPoint.nameColumn)} AS text) AS ${qident('__chartsdk_point_name')}`] : []),
        ...(cfg.geoPoint.valueColumn ? [`${qcol(cfg.geoPoint.valueColumn)} AS ${qident('__chartsdk_point_value')}`] : []),
        ...(cfg.geoPoint.sizeColumn ? [`${qcol(cfg.geoPoint.sizeColumn)} AS ${qident('__chartsdk_size')}`] : []),
        ...(cfg.seriesBy ? [`CAST(${qcol(cfg.seriesBy)} AS text) AS ${qident('__chartsdk_series')}`] : []),
      ];
      const finalSelects = [
        `ST_X(${spatial}.${qident('__chartsdk_spatial_value')}) AS ${qident('__chartsdk_longitude')}`,
        `ST_Y(${spatial}.${qident('__chartsdk_spatial_value')}) AS ${qident('__chartsdk_latitude')}`,
        ...(cfg.geoPoint.nameColumn ? [`${spatial}.${qident('__chartsdk_point_name')} AS ${qident('__chartsdk_point_name')}`] : []),
        ...(cfg.geoPoint.valueColumn ? [`${spatial}.${qident('__chartsdk_point_value')} AS ${qident('__chartsdk_point_value')}`] : []),
        ...(cfg.geoPoint.sizeColumn ? [`${spatial}.${qident('__chartsdk_size')} AS ${qident('__chartsdk_size')}`] : []),
        ...(cfg.seriesBy ? [`${spatial}.${qident('__chartsdk_series')} AS ${qident('__chartsdk_series')}`] : []),
      ];
      return resultRandomSpatialSql(point, projected, finalSelects);
    }
    const wgs84 = `ST_Transform((${point})::geometry, 4326)`;
    const selects = [
      `ST_X(${wgs84}) AS ${qident('__chartsdk_longitude')}`,
      `ST_Y(${wgs84}) AS ${qident('__chartsdk_latitude')}`,
      ...(cfg.geoPoint.nameColumn ? [`CAST(${qcol(cfg.geoPoint.nameColumn)} AS text) AS ${qident('__chartsdk_point_name')}`] : []),
      ...(cfg.geoPoint.valueColumn ? [`${qcol(cfg.geoPoint.valueColumn)} AS ${qident('__chartsdk_point_value')}`] : []),
      ...(cfg.geoPoint.sizeColumn ? [`${qcol(cfg.geoPoint.sizeColumn)} AS ${qident('__chartsdk_size')}`] : []),
      ...(cfg.seriesBy ? [`CAST(${qcol(cfg.seriesBy)} AS text) AS ${qident('__chartsdk_series')}`] : []),
    ];
    return spatialProjectionSql(selects, point);
  }
  if (!cfg.xAxis || cfg.yAxis.length === 0) return '';
  const geoPointRoles = [
    ...(cfg.geoPoint?.nameColumn ? [{ column: cfg.geoPoint.nameColumn, alias: '__chartsdk_point_name', text: true }] : []),
    ...(cfg.geoPoint?.valueColumn ? [{ column: cfg.geoPoint.valueColumn, alias: '__chartsdk_point_value', text: false }] : []),
    ...(cfg.geoPoint?.sizeColumn ? [{ column: cfg.geoPoint.sizeColumn, alias: '__chartsdk_size', text: false }] : []),
  ];
  const rawMode = cfg.yAxis.some((y) => y.agg === 'none');
  if (rawMode) {
    if (plan?.approximate && plan.method === 'RESULT_RANDOM') {
      const population = qident('__chartsdk_population');
      const sample = qident('__chartsdk_sample');
      const xAlias = '__chartsdk_x';
      const yAliases = cfg.yAxis.map((_, i) => `__chartsdk_y_${i}`);
      const projected = [
        `${qcol(cfg.xAxis)} AS ${qident(xAlias)}`,
        ...(cfg.seriesBy ? [`${qcol(cfg.seriesBy)} AS ${qident('__chartsdk_series')}`] : []),
        ...cfg.yAxis.map((y, i) => `${qcol(y.column)} AS ${qident(yAliases[i])}`),
        ...(geoPointSeries ? geoPointRoles.map((role) => `${role.text ? `CAST(${qcol(role.column)} AS text)` : qcol(role.column)} AS ${qident(role.alias)}`) : []),
      ];
      const barrier = (cfg.joins?.length ?? 0) > 0 ? ' OFFSET 0' : '';
      const populationCte = `${population} AS (SELECT ${projected.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${where}${barrier})`;
      const sampleBody = `SELECT ${population}.* FROM ${population} WHERE random() < ${resultBernoulliProbability(plan)}`;
      const ctes = [
        populationCte,
        `${sample} AS MATERIALIZED (${sampleBody})`,
      ];
      const selects = [
        `${qcol(`__chartsdk_sample.${xAlias}`)} AS ${qident(geoPointSeries ? '__chartsdk_longitude' : geoAreaSeries ? '__chartsdk_area_name' : colName(cfg.xAxis))}`,
        ...(cfg.seriesBy ? [`${qcol('__chartsdk_sample.__chartsdk_series')} AS ${qident(geoPointSeries || geoAreaSeries ? '__chartsdk_series' : colName(cfg.seriesBy))}`] : []),
        ...cfg.yAxis.map((y, i) => `${qcol(`__chartsdk_sample.${yAliases[i]}`)} AS ${qident(geoPointSeries ? (i === 0 ? '__chartsdk_latitude' : '__chartsdk_size') : geoAreaSeries && i === 0 ? '__chartsdk_area_value' : aliasOf(y))}`),
        ...(geoPointSeries ? geoPointRoles.map((role) => `${qcol(`__chartsdk_sample.${role.alias}`)} AS ${qident(role.alias)}`) : []),
      ];
      return `WITH ${ctes.join(',\n')}
SELECT ${selects.join(', ')}
FROM ${sample}${orderSql()}`;
    }

    const indexRandom = plan?.approximate === true && plan.method === 'INDEX_RANDOM';
    const sourceColumn = (ref: string) => indexRandom ? qident(colName(ref)) : qcol(ref);
    const selects = [
      geoPointSeries
        ? `${sourceColumn(cfg.xAxis)} AS ${qident('__chartsdk_longitude')}`
        : geoAreaSeries
          ? `CAST(${sourceColumn(cfg.xAxis)} AS text) AS ${qident('__chartsdk_area_name')}`
          : sourceColumn(cfg.xAxis),
      ...(cfg.seriesBy ? [`${geoPointSeries || geoAreaSeries ? `CAST(${sourceColumn(cfg.seriesBy)} AS text)` : sourceColumn(cfg.seriesBy)} AS ${qident(geoPointSeries || geoAreaSeries ? '__chartsdk_series' : colName(cfg.seriesBy))}`] : []),
      ...cfg.yAxis.map((y, index) => `${sourceColumn(y.column)} AS ${qident(geoPointSeries ? (index === 0 ? '__chartsdk_latitude' : '__chartsdk_size') : geoAreaSeries && index === 0 ? '__chartsdk_area_value' : aliasOf(y))}`),
      ...(geoPointSeries ? geoPointRoles.map((role) => `${role.text ? `CAST(${sourceColumn(role.column)} AS text)` : sourceColumn(role.column)} AS ${qident(role.alias)}`) : []),
    ];
    if (indexRandom) {
      const seed = plan.seed ?? DEFAULT_SAMPLE_SEED;
      const population = Math.max(1, plan.populationEstimate);
      const cte = `WITH ${qident('__chartsdk_seed')} AS MATERIALIZED (SELECT setseed(${Math.max(-1, Math.min(1, (seed / 2_147_483_647) * 2 - 1))}) AS ${qident('seeded')}),\n`
        + `${qident('__chartsdk_keys')} AS MATERIALIZED (SELECT 1 + floor(random() * ${population})::bigint AS ${qident('v')} FROM ${qident('__chartsdk_seed')} CROSS JOIN generate_series(1, ${plan.sampleSize})),\n`
        + `${qident('__chartsdk_sample')} AS (SELECT ${qident('__chartsdk_base')}.* FROM ${qident('__chartsdk_keys')} JOIN ${qtable(cfg.table, multi)} ${qident('__chartsdk_base')} ON ${qident('__chartsdk_base')}.${qident('id')} = ${qident('__chartsdk_keys')}.${qident('v')}) `;
      return `${cte}SELECT ${selects.join(', ')}\nFROM ${qident('__chartsdk_sample')}${where}${orderSql()}`;
    }
    const systemSample = plan?.approximate && plan.method === 'SYSTEM'
      ? ` TABLESAMPLE SYSTEM (${plan.executionRate}) REPEATABLE (${plan.seed})`
      : '';
    return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${systemSample}${joinSql}${where}${orderSql()}`;
  }
  const aggSql: Record<string, (expr: string) => string> = {
    sum: (expr) => `SUM(${expr})`,
    avg: (expr) => `AVG(${expr})`,
    stddev: (expr) => `STDDEV(${expr})`,
    variance: (expr) => `VARIANCE(${expr})`,
    count: (expr) => `COUNT(${expr})`,
    count_distinct: (expr) => `COUNT(DISTINCT ${expr})`,
    min: (expr) => `MIN(${expr})`,
    max: (expr) => `MAX(${expr})`,
  };
  const approximate = plan?.approximate === true;

  // JOIN+WHERE 또는 VIEW 조회 결과를 먼저 확정한 뒤, 그 결과 행을 뽑고 마지막에 집계한다.
  if (plan?.approximate && plan.method === 'RESULT_RANDOM') {
    const population = qident('__chartsdk_population');
    const sample = qident('__chartsdk_sample');
    const nCte = qident('__chartsdk_n');
    const xAlias = '__chartsdk_x';
    const yAliases = cfg.yAxis.map((_, i) => `__chartsdk_y_${i}`);
    const projected = [
      `${qcol(cfg.xAxis)} AS ${qident(xAlias)}`,
      ...(cfg.seriesBy ? [`${qcol(cfg.seriesBy)} AS ${qident('__chartsdk_series')}`] : []),
      ...cfg.yAxis.map((y, i) => `${qcol(y.column)} AS ${qident(yAliases[i])}`),
    ];
    const barrier = (cfg.joins?.length ?? 0) > 0 ? ' OFFSET 0' : '';
    const populationCte = `${population} AS (SELECT ${projected.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${where}${barrier})`;
    const sampleBody = `SELECT ${population}.* FROM ${population} WHERE random() < ${resultBernoulliProbability(plan)}`;
    const ctes = [
      populationCte,
      `${sample} AS MATERIALIZED (${sampleBody})`,
      `${nCte} AS (SELECT COUNT(*) AS ${qident('sampled')} FROM ${sample})`,
    ];
    const sampleX = qcol(`__chartsdk_sample.${xAlias}`);
    const xCol = cfg.xAxisBucket
      ? `DATE_TRUNC('${cfg.xAxisBucket}', ${sampleX}) AS ${qident(colName(cfg.xAxis))}`
      : `${sampleX} AS ${qident(geoAreaSeries ? '__chartsdk_area_name' : colName(cfg.xAxis))}`;
    const hiddenMoments = cfg.yAxis.flatMap((y, i) => {
      if (!['avg', 'stddev', 'variance'].includes(y.agg)) return [];
      const expr = qcol(`__chartsdk_sample.${yAliases[i]}`);
      return [
        `COUNT(${expr}) AS ${qident(`__chartsdk_sample_n_${i}`)}`,
        `AVG(${expr}) AS ${qident(`__chartsdk_sample_mean_${i}`)}`,
        `STDDEV_SAMP(${expr}) AS ${qident(`__chartsdk_sample_sd_${i}`)}`,
      ];
    });
    const selects = [
      xCol,
      ...(cfg.seriesBy ? [`${qcol('__chartsdk_sample.__chartsdk_series')} AS ${qident(geoAreaSeries ? '__chartsdk_series' : colName(cfg.seriesBy))}`] : []),
      ...cfg.yAxis.map((y, i) => `${aggSql[y.agg](qcol(`__chartsdk_sample.${yAliases[i]}`))} AS ${qident(geoAreaSeries && i === 0 ? '__chartsdk_area_value' : aliasOf(y))}`),
      `COUNT(*) AS ${qident('__chartsdk_sample_count')}`,
      `(SELECT ${qident('sampled')} FROM ${nCte}) AS ${qident('__chartsdk_sample_total')}`,
      ...hiddenMoments,
    ];
    return `WITH ${ctes.join(',\n')}
SELECT ${selects.join(', ')}
FROM ${sample}
GROUP BY ${cfg.xAxisBucket ? '1' : sampleX}${cfg.seriesBy ? `, ${qcol('__chartsdk_sample.__chartsdk_series')}` : ''}${orderSql()}`;
  }

  const indexRandom = plan?.approximate === true && plan.method === 'INDEX_RANDOM';
  const sourceColumn = (ref: string) => indexRandom ? qident(colName(ref)) : qcol(ref);
  const xSource = sourceColumn(cfg.xAxis);
  const xCol = cfg.xAxisBucket
    ? `DATE_TRUNC('${cfg.xAxisBucket}', ${xSource}) AS ${qident(colName(cfg.xAxis))}`
    : geoAreaSeries ? `CAST(${xSource} AS text) AS ${qident('__chartsdk_area_name')}` : xSource;
  const hiddenMoments = indexRandom ? cfg.yAxis.flatMap((y, i) => {
    if (!['avg', 'stddev', 'variance'].includes(y.agg)) return [];
    const expr = sourceColumn(y.column);
    return [
      `COUNT(${expr}) AS ${qident(`__chartsdk_sample_n_${i}`)}`,
      `AVG(${expr}) AS ${qident(`__chartsdk_sample_mean_${i}`)}`,
      `STDDEV_SAMP(${expr}) AS ${qident(`__chartsdk_sample_sd_${i}`)}`,
    ];
  }) : [];
  const selects = [
    xCol,
    ...(cfg.seriesBy ? [geoAreaSeries
      ? `CAST(${sourceColumn(cfg.seriesBy)} AS text) AS ${qident('__chartsdk_series')}`
      : sourceColumn(cfg.seriesBy)] : []),
    ...cfg.yAxis.map((y, index) => `${aggSql[y.agg](sourceColumn(y.column))} AS ${qident(geoAreaSeries && index === 0 ? '__chartsdk_area_value' : aliasOf(y))}`),
    ...(approximate
      ? [
          `COUNT(*) AS ${qident('__chartsdk_sample_count')}`,
          indexRandom
            ? `(SELECT ${qident('sampled')} FROM ${qident('__chartsdk_n')}) AS ${qident('__chartsdk_sample_total')}`
            : `SUM(COUNT(*)) OVER () AS ${qident('__chartsdk_sample_total')}`,
          ...hiddenMoments,
        ]
      : []),
  ];
  const group = `${cfg.xAxisBucket ? '1' : xSource}${cfg.seriesBy ? `, ${sourceColumn(cfg.seriesBy)}` : ''}`;
  if (indexRandom) {
    const indexPlan = plan!;
    const seed = indexPlan.seed ?? DEFAULT_SAMPLE_SEED;
    const population = Math.max(1, indexPlan.populationEstimate);
    const cte = `WITH ${qident('__chartsdk_seed')} AS MATERIALIZED (SELECT setseed(${Math.max(-1, Math.min(1, (seed / 2_147_483_647) * 2 - 1))}) AS ${qident('seeded')}),\n`
      + `${qident('__chartsdk_keys')} AS MATERIALIZED (SELECT 1 + floor(random() * ${population})::bigint AS ${qident('v')} FROM ${qident('__chartsdk_seed')} CROSS JOIN generate_series(1, ${indexPlan.sampleSize})),\n`
      + `${qident('__chartsdk_sample')} AS (SELECT ${qident('__chartsdk_base')}.* FROM ${qident('__chartsdk_keys')} JOIN ${qtable(cfg.table, multi)} ${qident('__chartsdk_base')} ON ${qident('__chartsdk_base')}.${qident('id')} = ${qident('__chartsdk_keys')}.${qident('v')}),\n`
      + `${qident('__chartsdk_n')} AS (SELECT COUNT(*) AS ${qident('sampled')} FROM ${qident('__chartsdk_sample')}) `;
    return `${cte}SELECT ${selects.join(', ')}\nFROM ${qident('__chartsdk_sample')}${where}\nGROUP BY ${group}${orderSql()}`;
  }
  const systemSample = plan?.approximate && plan.method === 'SYSTEM'
    ? ` TABLESAMPLE SYSTEM (${plan.executionRate}) REPEATABLE (${plan.seed})`
    : '';
  return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${systemSample}${joinSql}${where}\nGROUP BY ${group}${orderSql()}`;
}

/** X/Y 없는 실행 결과용 행 조회 SQL 표시. 조건과 원본 컬럼 정렬만 적용한다. */
export function buildRowsSql(cfg: BuilderConfig): string {
  if (!cfg.table) return '';
  const multi = new Set([cfg.table.datasourceId, ...(cfg.joins ?? []).map((join) => join.table.datasourceId)]).size >= 2;
  const where = cfg.where.length ? ` WHERE ${cfg.where.map((condition) => whereSql(condition)).join(' AND ')}` : '';
  const joins = (cfg.joins ?? [])
    .map((join) => ` ${join.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${qtable(join.table, multi)} ON ${qcol(join.on.leftColumn)} = ${qcol(join.on.rightColumn)}`)
    .join('');
  const target = cfg.orderBy?.target.startsWith('column:')
    ? cfg.orderBy.target.slice('column:'.length)
    : null;
  const order = target && cfg.orderBy
    ? ` ORDER BY ${qcol(target)} ${cfg.orderBy.direction.toUpperCase()}`
    : '';
  return `SELECT *\nFROM ${qtable(cfg.table, multi)}${joins}${where}${order}\nLIMIT 1000`;
}

/** 표본 비율 0.1~100, 소수점 한 자리 정규화 (생성규칙 3C·9장) */
export const clampRate = normalizeSampleRate;

function baseRelationForConfig(cfg: BuilderConfig): SchemaTable | undefined {
  if (!cfg.table) return undefined;
  return schemaTables.find((table) =>
    table.datasourceId === cfg.table!.datasourceId
    && table.schema === cfg.table!.schema
    && table.name === cfg.table!.name,
  );
}

function populationEstimateForConfig(cfg: BuilderConfig): number {
  return baseRelationForConfig(cfg)?.estimatedRowCount ?? 0;
}

type MockSamplePlan = {
  method: SamplingMetadata['method'];
  approximate: boolean;
  populationEstimate: number;
  sampleSize: number;
  executionRate: number;
  seed?: number;
};

function resultBernoulliProbability(plan: MockSamplePlan): number {
  if (plan.populationEstimate <= 0) return 1;
  return Math.max(0, Math.min(1, plan.sampleSize / plan.populationEstimate));
}

/** 서버 SamplingPlanner의 관계 종류·크기·레거시 SYSTEM 결정 순서를 미러한다. */
function samplePlanForConfig(cfg: BuilderConfig): MockSamplePlan | undefined {
  if (!cfg.sample) return undefined;
  const legacyRate = cfg.sample.rate;
  const seed = Math.trunc(cfg.sample.seed ?? DEFAULT_SAMPLE_SEED);
  if (legacyRate != null && legacyRate >= 100) {
    return { method: 'FULL_SCAN', approximate: false, populationEstimate: populationEstimateForConfig(cfg), sampleSize: 0, executionRate: 100 };
  }

  const relation = baseRelationForConfig(cfg);
  const resultPopulation = (cfg.joins?.length ?? 0) > 0 || relation?.relationType === 'VIEW';
  // 실제 서버는 JOIN+WHERE를 EXPLAIN한다. mock은 실행기가 없으므로 base 통계를 계획치로 사용한다.
  const populationEstimate = relation?.estimatedRowCount ?? 0;
  const sampleSize = normalizeSampleSize(cfg.sample.size
    ?? (legacyRate != null && populationEstimate > 0
      ? Math.round(populationEstimate * legacyRate / 100)
      : DEFAULT_SAMPLE_SIZE));
  const executionRate = legacyRate != null
    ? clampRate(legacyRate)
    : normalizeSampleRate(populationEstimate > 0 ? (sampleSize / populationEstimate) * 100 : Number.NaN);

  if (resultPopulation) {
    return { method: 'RESULT_RANDOM', approximate: true, populationEstimate, sampleSize, executionRate, seed };
  }
  const systemPinned = cfg.sample.method === 'system' || legacyRate != null;
  if (systemPinned) {
    return { method: 'SYSTEM', approximate: true, populationEstimate, sampleSize, executionRate, seed };
  }
  if (populationEstimate > 0 && populationEstimate <= FULL_SCAN_ROWS) {
    return { method: 'FULL_SCAN', approximate: false, populationEstimate, sampleSize: 0, executionRate: 100, seed };
  }
  // mock에는 PK 카탈로그가 없다. 일반 TABLE은 정수 PK 사용 가능, MV·통계 미상 관계는 SYSTEM 폴백으로 모사한다.
  if (relation?.relationType === 'MATERIALIZED_VIEW' || populationEstimate <= 0) {
    return { method: 'SYSTEM', approximate: true, populationEstimate, sampleSize, executionRate, seed };
  }
  return { method: 'INDEX_RANDOM', approximate: true, populationEstimate, sampleSize, executionRate, seed };
}

/** 서버 SamplingMetadata.putInto의 레거시 sampleRate 별칭 계산을 미러한다. */
function legacySampleRate(sampling: SamplingMetadata): number {
  if (!sampling.approximate) return 100;
  if (sampling.rate != null) return sampling.rate;
  if (sampling.populationEstimate && sampling.sampleSize != null) {
    return normalizeSampleRate((sampling.sampleSize / sampling.populationEstimate) * 100);
  }
  return normalizeSampleRate(Number.NaN);
}

function samplingForConfig(cfg: BuilderConfig, labels: unknown[]): SamplingMetadata | undefined {
  if (!cfg.sample) return undefined;
  const mode = cfg.sample.mode === 'auto' ? 'auto' : 'manual';
  const requestedMethod = cfg.sample.method === 'system' ? 'system' : 'auto';
  const legacyRate = cfg.sample.rate;
  const plan = samplePlanForConfig(cfg)!;

  if (!plan.approximate) {
    return {
      version: SAMPLING_CONTRACT_VERSION, mode, requestedMethod,
      approximate: false, method: 'FULL_SCAN', ...(legacyRate != null ? { rate: 100 } : {}),
      ...(cfg.sample.size != null ? { sizeTarget: cfg.sample.size } : {}),
      ...(plan.seed != null ? { seed: plan.seed } : {}), valueMode: 'exact',
      estimates: cfg.yAxis.map((y) => ({ series: aliasOf(y), aggregate: y.agg, treatment: 'EXACT' as const })),
    };
  }

  const { method, populationEstimate, sampleSize, executionRate } = plan;
  const uniformRandom = method === 'INDEX_RANDOM' || method === 'RESULT_RANDOM';
  const realizedSampleSize = method === 'RESULT_RANDOM'
    ? Math.max(0, Math.min(populationEstimate || Number.MAX_SAFE_INTEGER,
      Math.round(sampleSize - Math.sqrt(sampleSize))))
    : sampleSize;
  const rowSample = cfg.yAxis.length > 0 && cfg.yAxis.every((y) => y.agg === 'none');
  const groups = rowSample ? [] : labels.map((key, index) => ({
    key,
    sampleCount: uniformRandom
      ? Math.floor(realizedSampleSize / Math.max(1, labels.length))
        + (index < realizedSampleSize % Math.max(1, labels.length) ? 1 : 0)
      : Math.max(1, Math.round((5_000 + index * 350) * (executionRate / 100))),
  }));
  const estimates = cfg.yAxis.map((y) => {
    const warning = samplingWarningForAggregate(y.agg);
    const base = { series: aliasOf(y), aggregate: y.agg, treatment: samplingTreatment(y.agg, true), ...(warning ? { warning } : {}) };
    // 균일 행 표본(INDEX_RANDOM/RESULT_RANDOM)은 분산 계열의 비대칭 그룹별 구간을 포함한다.
    if (uniformRandom && ['stddev', 'variance'].includes(y.agg)) {
      const variance = y.agg === 'variance';
      const estimate = variance ? 100 : 10;
      const lower95 = variance ? 77.1 : 8.78;
      const upper95 = variance ? 135 : 11.62;
      const relativeErrorPct = variance ? 35 : 16.2;
      return {
        ...base, marginOfError: upper95 - estimate, relativeErrorPct,
        intervals: groups.map((group) => ({ ...group, estimate, lower95, upper95, relativeErrorPct })),
      };
    }
    return uniformRandom && y.agg === 'avg'
      ? { ...base, marginOfError: 12, relativeErrorPct: 1.2 } : base;
  });
  const methodWarning: SamplingWarningCode = method === 'SYSTEM'
    ? 'BLOCK_SAMPLE_CLUSTERING'
    : method === 'RESULT_RANDOM' ? 'RESULT_RANDOM_SAMPLE' : 'INDEX_RANDOM_SAMPLE';
  const warnings = new Set<SamplingWarningCode>([methodWarning]);
  if (method === 'RESULT_RANDOM' && populationEstimate <= 0) {
    warnings.add('RESULT_POPULATION_ESTIMATE_UNAVAILABLE');
  }
  estimates.forEach((estimate) => { if (estimate.warning) warnings.add(estimate.warning); });
  if (uniformRandom && cfg.yAxis.some((y) => y.agg === 'stddev' || y.agg === 'variance')) {
    warnings.add('STDDEV_CI_NORMALITY_ASSUMED');
  }
  return {
    version: SAMPLING_CONTRACT_VERSION, mode, requestedMethod,
    approximate: true, method,
    ...(legacyRate != null ? { rate: executionRate } : {}),
    ...(cfg.sample.size != null ? { sizeTarget: cfg.sample.size } : {}),
    seed: plan.seed,
    valueMode: 'sample',
    ...(method === 'RESULT_RANDOM' && populationEstimate <= 0 ? {} : { populationEstimate }), sampleSize,
    sampledRowCount: rowSample
      ? labels.length
      : groups.reduce((sum, group) => sum + group.sampleCount, 0),
    ...(uniformRandom && !rowSample ? { confidenceLevel: 0.95 } : {}),
    groups, estimates,
    warnings: [...warnings],
  };
}

// map 데모용 시·도 라벨 — kr-sido.json properties.name 과 정확히 일치해야 지도에 값이 칠해진다.
const SAMPLE_REGIONS = [
  '서울특별시',
  '전남광주통합특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '경기도',
  '강원특별자치도',
  '충청북도',
  '경상북도',
  '제주특별자치도',
];

/** 집계 결과 rows 생성 — 카테고리/월 라벨 + yAxis별 가짜 값 */
export function buildAggregateRows(cfg: BuilderConfig, chartType?: ChartType): QueryResult {
  if (cfg.seriesBy && (chartType === 'bar' || chartType === 'line')) {
    const years = ['2012', '2013', '2014', '2015'];
    const xType = builderColumnType(cfg, cfg.xAxis);
    const categories = isTemporalColumnType(xType)
      ? SAMPLE_MONTHS
      : ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '경기도'];
    const columns: Cols = [
      { name: cfg.xAxis ? colName(cfg.xAxis) : 'region', type: xType },
      ...years.map((year) => ({ name: year, type: 'numeric' })),
    ];
    const rows: Rows = categories.map((category, categoryIndex) => [
      category,
      ...years.map((_year, yearIndex) => 2_500_000 + categoryIndex * 1_150_000 + yearIndex * 85_000),
    ]);
    const sampling = samplingForConfig(cfg, categories);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 12 : 24,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  }
  // 상자수염: 카테고리별로 원본값 여러 개(분포) — 변환기가 그룹핑해 5수 요약 계산.
  if (chartType === 'boxplot') {
    const valName = cfg.yAxis[0] ? colName(cfg.yAxis[0].column) : 'value';
    const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'category', type: 'text' }, { name: valName, type: 'numeric' }];
    const rows: Rows = [];
    SAMPLE_CATS.forEach((cat, ci) => {
      const center = 100 + ci * 45;
      const spread = 8 + ci * 3;
      for (let k = 0; k < 9; k++) rows.push([cat, Math.round(center + (k - 4) * spread + (k % 3) * 6)]);
      rows.push([cat, center + spread * 12]);
    });
    const sampling = samplingForConfig(cfg, rows.map((row) => row[0]));
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 12 : 20,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  }
  const geoSeriesType = cfg.geoSeriesType ?? (chartType === 'map' ? 'map' : chartType === 'geoscatter' ? 'scatter' : undefined);
  // 지도: 시·도/Polygon 영역값. seriesBy가 있으면 같은 경계를 여러 ECharts map 계열로 나눈다.
  if (chartType === 'map' && geoSeriesType === 'map') {
    if (cfg.geoArea?.mode === 'spatial') {
      const columns: Cols = [
        { name: '__chartsdk_area_name', type: 'text' },
        { name: '__chartsdk_area_value', type: 'numeric' },
        { name: '__chartsdk_geojson', type: 'text' },
        ...(cfg.seriesBy ? [{ name: '__chartsdk_series', type: 'text' }] : []),
      ];
      const rows: Rows = SAMPLE_SPATIAL_AREAS.flatMap(([name, value, geometry]) =>
        cfg.seriesBy
          ? [['A', 1], ['B', 0.72]].map(([series, ratio]) => [name, Number(value) * Number(ratio), JSON.stringify(geometry), series])
          : [[name, value, JSON.stringify(geometry)]]);
      const sampling = samplingForConfig(cfg, rows.map((row) => row[0]));
      return {
        columns,
        rows,
        rowCount: rows.length,
        truncated: false,
        elapsedMs: sampling?.approximate ? 12 : 20,
        ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
      };
    }
    const columns: Cols = [
      { name: '__chartsdk_area_name', type: 'text' },
      { name: '__chartsdk_area_value', type: 'numeric' },
      ...(cfg.seriesBy ? [{ name: '__chartsdk_series', type: 'text' }] : []),
    ];
    const sampling = samplingForConfig(cfg, SAMPLE_REGIONS);
    const rows: Rows = SAMPLE_REGIONS.flatMap((region, index) => {
      const value = Math.round(500 - index * 32 + (index % 3) * 45);
      return cfg.seriesBy ? [[region, value, 'A'], [region, Math.round(value * 0.72), 'B']] : [[region, value]];
    });
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 12 : 20,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  }
  // 지도 좌표: map/heatmap 또는 point/scatter·effectScatter가 같은 역할 열 계약을 사용한다.
  if (chartType === 'geoscatter' || (chartType === 'map' && geoSeriesType === 'heatmap')) {
    const hasName = !!cfg.geoPoint?.nameColumn;
    const hasValue = !!cfg.geoPoint?.valueColumn;
    const hasSize = chartType === 'geoscatter' && !!cfg.geoPoint?.sizeColumn;
    const columns: Cols = [
      { name: '__chartsdk_longitude', type: 'numeric' },
      { name: '__chartsdk_latitude', type: 'numeric' },
      ...(hasName ? [{ name: '__chartsdk_point_name', type: 'text' }] : []),
      ...(hasValue ? [{ name: '__chartsdk_point_value', type: 'numeric' }] : []),
      ...(hasSize ? [{ name: '__chartsdk_size', type: 'numeric' }] : []),
      ...(cfg.seriesBy ? [{ name: '__chartsdk_series', type: 'text' }] : []),
    ];
    const rows: Rows = SAMPLE_SPATIAL_POINTS.map(([longitude, latitude, size], index) => [
      longitude,
      latitude,
      ...(hasName ? [`포인트 ${index + 1}`] : []),
      ...(hasValue ? [Math.round(Number(size) * 1.7)] : []),
      ...(hasSize ? [size] : []),
      ...(cfg.seriesBy ? [index % 2 === 0 ? 'A' : 'B'] : []),
    ]);
    const sampling = samplingForConfig(cfg, rows.map((row) => row[0]));
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 12 : 20,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  }
  if (cfg.yAxis.some((y) => y.agg === 'none')) {
    const sourceColumns = columnsForBuilder(cfg, schemaTables);
    const typeOf = (reference: string | null | undefined) =>
      sourceColumns.find((column) => column.value === reference)?.type ?? 'numeric';
    const xType = typeOf(cfg.xAxis);
    const yTypes = cfg.yAxis.map((y) => typeOf(y.column));
    const columns: Cols = [
      { name: cfg.xAxis ? colName(cfg.xAxis) : 'x', type: xType },
      ...cfg.yAxis.map((y, index) => ({ name: aliasOf(y), type: yTypes[index] })),
    ];
    const rows: Rows = Array.from({ length: 12 }, (_, i) => [
      sampleValue(xType, i),
      ...yTypes.map((type) => sampleValue(type, i)),
    ]);
    const sampling = samplingForConfig(cfg, rows.map((row) => row[0]));
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 10 : 18,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  }
  const xType = builderColumnType(cfg, cfg.xAxis);
  const labels = cfg.xAxisBucket || isTemporalColumnType(xType) ? SAMPLE_MONTHS : SAMPLE_CATS;
  const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'x', type: xType }, ...cfg.yAxis.map((y) => ({ name: aliasOf(y), type: 'numeric' }))];
  const sampling = samplingForConfig(cfg, labels);
  // sampling v7: 모든 집계값은 선택된 표본에서 계산한 값을 그대로 표시한다.
  const rows: Rows = labels.map((label, i) => [
    label,
    ...cfg.yAxis.map((_y, j) => Math.round(500 - i * 70 + j * 130 + (i % 2) * 40)),
  ]);
  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: false,
    elapsedMs: (sampling?.approximate ? 12 : 40) + rows.length, // 표본은 전체 스캔을 건너뛰어 더 빠름
    ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
  };
}

function builderColumnType(cfg: BuilderConfig, reference: string | null | undefined): string {
  if (!reference) return 'text';
  return columnsForBuilder(cfg, schemaTables).find((column) => column.value === reference)?.type ?? 'text';
}

function sampleValue(type: string, i: number): unknown {
  const t = type.toLowerCase();
  if (t.includes('geometry') || t.includes('geography')) {
    const [lng, lat] = SAMPLE_SPATIAL_POINTS[i % SAMPLE_SPATIAL_POINTS.length];
    return `POINT(${lng} ${lat})`;
  }
  if (t.includes('int') || t.includes('numeric')) return (i + 1) * 7;
  if (t.includes('date') || t.includes('time')) return `2026-0${(i % 6) + 1}-15`;
  return ['의류', '식품', '가전', '도서', '생활'][i % 5];
}

function compareValues(actual: unknown, expected: unknown): number {
  if (typeof actual === 'number') return actual - Number(expected);
  return String(actual ?? '').localeCompare(String(expected ?? ''), 'ko');
}

function matchesCondition(actual: unknown, condition: BuilderConfig['where'][number]): boolean {
  const expected = condition.value;
  switch (condition.op) {
    case 'is_null': return actual == null;
    case 'is_not_null': return actual != null;
    case 'eq': return actual != null && compareValues(actual, expected) === 0;
    case 'neq': return actual == null || compareValues(actual, expected) !== 0;
    case 'gt': return actual != null && compareValues(actual, expected) > 0;
    case 'gte': return actual != null && compareValues(actual, expected) >= 0;
    case 'lt': return actual != null && compareValues(actual, expected) < 0;
    case 'lte': return actual != null && compareValues(actual, expected) <= 0;
    case 'contains': return String(actual ?? '').toLocaleLowerCase('ko').includes(String(expected ?? '').toLocaleLowerCase('ko'));
    case 'starts_with': return String(actual ?? '').toLocaleLowerCase('ko').startsWith(String(expected ?? '').toLocaleLowerCase('ko'));
    case 'in': return actual != null && (Array.isArray(expected) ? expected : [expected]).some((value) => compareValues(actual, value) === 0);
    case 'between': {
      const values = Array.isArray(expected) ? expected : [];
      return values.length === 2
        && actual != null
        && compareValues(actual, values[0]) >= 0
        && compareValues(actual, values[1]) <= 0;
    }
  }
}

/** X/Y 없는 실행 결과(mode:rows) — 전체 컬럼에 조건·원본 컬럼 정렬을 적용한다. */
export function buildRawRows(cfg: BuilderConfig): QueryResult {
  const options = columnsForBuilder(cfg, schemaTables);
  const columns: Cols = options.map((column) => {
    const name = colName(column.value);
    const displayName = fieldDisplayNameForRef(column.value, cfg, schemaTables);
    return {
      name,
      type: column.type,
      ...(displayName !== name ? { displayName } : {}),
    };
  });
  let rows: Rows = Array.from({ length: 12 }, (_, index) => options.map((column) => sampleValue(column.type, index)));
  rows = rows.filter((row) => cfg.where.every((condition) => {
    const columnIndex = options.findIndex((column) => column.value === condition.column);
    return columnIndex >= 0 && matchesCondition(row[columnIndex], condition);
  }));

  const orderColumn = cfg.orderBy?.target.startsWith('column:')
    ? cfg.orderBy.target.slice('column:'.length)
    : null;
  const orderIndex = orderColumn ? options.findIndex((column) => column.value === orderColumn) : -1;
  if (orderIndex >= 0 && cfg.orderBy) {
    const direction = cfg.orderBy.direction === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const left = a[orderIndex];
      const right = b[orderIndex];
      if (left === right) return 0;
      if (left == null) return -direction;
      if (right == null) return direction;
      return (typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'ko')) * direction;
    });
  }
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 18 };
}

/** 테이블 원본 미리보기(GET schema preview) — 컬럼 타입별 가짜 값 */
/** Physical result keys remain stable; display names are additive response metadata only. */
export function withResultDisplayNames(
  result: QueryResult,
  cfg: BuilderConfig,
  pivoted = Boolean(cfg.seriesBy),
): QueryResult {
  const columns = result.columns.map((column) => ({ ...column }));
  if (columns.length === 0) return { ...result, columns };

  const setDisplayName = (index: number, displayName: string) => {
    const column = columns[index];
    if (column && displayName && displayName !== column.name) column.displayName = displayName;
  };
  setDisplayName(0, fieldDisplayName(cfg, cfg.xAxis, columns[0].name));

  if (pivoted && cfg.seriesBy) return { ...result, columns };

  let measureStart = 1;
  if (cfg.seriesBy && columns.length > 1) {
    setDisplayName(1, fieldDisplayName(cfg, cfg.seriesBy, columns[1].name));
    measureStart = 2;
  }
  cfg.yAxis.forEach((field, index) => {
    const column = columns[measureStart + index];
    if (column) setDisplayName(measureStart + index, measureDisplayName(cfg, field, column.name));
  });
  return { ...result, columns };
}

export function buildTablePreview(table: SchemaTable): QueryResult {
  const rows: Rows = Array.from({ length: 12 }, (_, i) => table.columns.map((c) => sampleValue(c.type, i)));
  return { columns: table.columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 12 };
}

const titleAtBottom = (o: any): boolean => !!o.title && (o.titleV ?? 'top') === 'bottom';
const presetBase = (preset?: string) =>
  preset === 'compact' ? { left: 8, right: 8, top: 8, bottom: 8 }
    : preset === 'loose' ? { left: 48, right: 48, top: 48, bottom: 48 }
      : { left: 24, right: 24, top: 28, bottom: 24 };
/** grid top/bottom 에 제목·범례 예약 높이 가산 (서버 applyMargins 미러). */
function gridMargins(o: any, includeLegend: boolean, horizontal = false): { left: number; right: number; top: number; bottom: number } {
  const b = presetBase(o.grid?.preset);
  const metrics = resolveChartLayoutMetrics(o);
  const axisFontSize = resolveChartTypography(o).axis;
  if (!!o.title && (o.titleV ?? 'top') === 'top') b.top += metrics.titleHeight;
  if (titleAtBottom(o)) b.bottom += metrics.titleHeight;
  if (includeLegend && o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    if (pos === 'top') b.top += metrics.legendHeight;
    if (pos === 'bottom') b.bottom += metrics.legendHeight;
  }
  const physicalXConfig = horizontal ? o.yAxis : o.xAxis;
  const physicalYConfig = horizontal ? o.xAxis : o.yAxis;
  const physicalXPosition = axisPosition(physicalXConfig, horizontal ? 'y' : 'x', 'x');
  const physicalYPosition = axisPosition(physicalYConfig, horizontal ? 'x' : 'y', 'y');
  const physicalXReserve = axisReserve(physicalXConfig, axisFontSize);
  const physicalYReserve = axisReserve(physicalYConfig, axisFontSize);
  b[physicalXPosition] += physicalXReserve;
  b[physicalYPosition] += physicalYReserve;
  const physicalXEndpointReserve = axisEndpointReserve(
    physicalXConfig,
    horizontal ? 'y' : 'x',
    'x',
    axisFontSize,
  );
  const physicalYEndpointReserve = axisEndpointReserve(
    physicalYConfig,
    horizontal ? 'x' : 'y',
    'y',
    axisFontSize,
  );
  if (physicalXConfig?.titleLocation === 'start') b.left += physicalXEndpointReserve;
  if (physicalXConfig?.titleLocation === 'end') b.right += physicalXEndpointReserve;
  if (physicalYConfig?.titleLocation === 'start') b.bottom += physicalYEndpointReserve;
  if (physicalYConfig?.titleLocation === 'end') b.top += physicalYEndpointReserve;
  if (!horizontal && o.yAxis?.secondAxis === true) {
    b[physicalYPosition === 'left' ? 'right' : 'left'] += physicalYReserve;
  }
  return b;
}

/** grid가 없는 원형·지도 계열도 제목·범례·색상 범례가 플롯을 가리지 않도록 박스 여백을 준다. */
function nonCartesianInsets(
  o: any,
  includeLegend: boolean,
  includeVisualMap = false,
): { top: number; bottom: number } {
  const metrics = resolveChartLayoutMetrics(o);
  let top = !!o.title && (o.titleV ?? 'top') === 'top' ? metrics.titleHeight : 0;
  let bottom = titleAtBottom(o) ? metrics.titleHeight : 0;
  if (includeLegend && o.legend?.show !== false) {
    const position = o.legend?.position ?? 'bottom';
    if (position === 'top') top += metrics.legendHeight;
    if (position === 'bottom') bottom += metrics.legendHeight;
  }
  if (includeVisualMap) bottom += metrics.visualMapHeight;
  return { top, bottom };
}

const AXIS_NAME_GAP = 56;
const AXIS_ENDPOINT_NAME_GAP = 8;

type AxisKind = 'x' | 'y';
type AxisPosition = 'top' | 'bottom' | 'left' | 'right';

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function axisPosition(config: any, logical: AxisKind, physical: AxisKind): AxisPosition {
  const logicalPosition: AxisPosition = logical === 'x'
    ? (config?.position === 'top' ? 'top' : 'bottom')
    : (config?.position === 'right' ? 'right' : 'left');
  if (logical === physical) return logicalPosition;
  if (logical === 'x') return logicalPosition === 'top' ? 'right' : 'left';
  return logicalPosition === 'right' ? 'top' : 'bottom';
}

function axisReserve(config: any, fontSize: number): number {
  if (typeof config?.title !== 'string' || !config.title.trim()) return 0;
  if (config?.titleLocation === 'start' || config?.titleLocation === 'end') return fontSize + 12;
  const gap = Math.max(0, finiteNumber(config?.titleGap, AXIS_NAME_GAP));
  return fontSize + 12 + Math.max(0, gap - AXIS_NAME_GAP);
}

function axisTitleRotation(config: any, logical: AxisKind, physical: AxisKind): number {
  const logicalDefault = logical === 'x' ? 0 : -90;
  const physicalDefault = physical === 'x' ? 0 : -90;
  return physicalDefault + finiteNumber(config?.titleRotate, logicalDefault) - logicalDefault;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  const units = Array.from(text).reduce((sum, character) => {
    if (/\s/u.test(character)) return sum + 0.35;
    return sum + (character.codePointAt(0)! <= 0x7f ? 0.58 : 1);
  }, 0);
  return Math.ceil(units * fontSize);
}

function axisEndpointReserve(
  config: any,
  logical: AxisKind,
  physical: AxisKind,
  fontSize: number,
): number {
  if (typeof config?.title !== 'string' || !config.title.trim()) return 0;
  if (config?.titleLocation !== 'start' && config?.titleLocation !== 'end') return 0;
  const rotation = axisTitleRotation(config, logical, physical) * Math.PI / 180;
  const textWidth = estimatedTextWidth(config.title.trim(), fontSize);
  const projectedLength = physical === 'x'
    ? Math.abs(Math.cos(rotation)) * textWidth + Math.abs(Math.sin(rotation)) * fontSize
    : Math.abs(Math.sin(rotation)) * textWidth + Math.abs(Math.cos(rotation)) * fontSize;
  return AXIS_ENDPOINT_NAME_GAP + Math.ceil(projectedLength);
}

function chartTextStyle(fontSize: number, fontFamily: string | null): Record<string, unknown> {
  return { fontSize, ...(fontFamily ? { fontFamily } : {}) };
}

function axisOptions(
  config: any,
  fontSize: number,
  logical: AxisKind,
  physical: AxisKind,
  fontFamily: string | null,
): Record<string, unknown> {
  const location = config?.titleLocation === 'start' || config?.titleLocation === 'end'
    ? config.titleLocation
    : 'middle';
  const position = axisPosition(config, logical, physical);
  return {
    ...(typeof config?.title === 'string' && config.title.trim()
      ? {
          name: config.title,
          nameLocation: location,
          nameGap: location === 'middle'
            ? Math.max(0, finiteNumber(config?.titleGap, AXIS_NAME_GAP))
            : AXIS_ENDPOINT_NAME_GAP,
          nameRotate: axisTitleRotation(config, logical, physical),
        }
      : {}),
    position,
    nameTextStyle: chartTextStyle(fontSize, fontFamily),
    ...(config?.verticalLabels === true ? { __chartsdkVerticalLabel: logical } : {}),
  };
}

function categoryAxisLabel(
  fontSize: number,
  rotate: unknown,
  config: any,
  defaultMode: 'all' | 'auto',
  hideOverlapOnAuto: boolean,
  fontFamily: string | null,
): Record<string, unknown> {
  const mode = config?.labelIntervalMode === 'step' || config?.labelIntervalMode === 'auto' || config?.labelIntervalMode === 'all'
    ? config.labelIntervalMode
    : defaultMode;
  const interval = mode === 'auto'
    ? 'auto'
    : mode === 'step'
      ? Math.max(0, Math.round(finiteNumber(config?.labelEvery, 2)) - 1)
      : 0;
  return {
    interval,
    ...(typeof rotate === 'number' && rotate !== 0 ? { rotate } : {}),
    ...(typeof config?.showMinLabel === 'boolean' ? { showMinLabel: config.showMinLabel } : {}),
    ...(typeof config?.showMaxLabel === 'boolean' ? { showMaxLabel: config.showMaxLabel } : {}),
    hideOverlap: hideOverlapOnAuto
      ? mode === 'auto'
      : mode !== 'all' && config?.hideOverlap === true,
    ...chartTextStyle(fontSize, fontFamily),
  };
}

function numericAxisOptions(
  config: any,
  type: 'value' | 'log',
  allowIntervalBounds: boolean,
): Record<string, unknown> {
  if (type === 'log') {
    return { logBase: Math.max(2, Math.round(finiteNumber(config?.logBase, 10))) };
  }
  if (config?.tickMode === 'fixed') {
    const interval = finiteNumber(config?.interval, 0);
    return {
      scale: config?.includeZero === false,
      ...(interval > 0 ? { interval } : {}),
    };
  }
  const minInterval = allowIntervalBounds ? finiteNumber(config?.minInterval, 0) : 0;
  const maxInterval = allowIntervalBounds ? finiteNumber(config?.maxInterval, 0) : 0;
  return {
    scale: config?.includeZero === false,
    splitNumber: Math.min(20, Math.max(2, Math.round(finiteNumber(config?.splitNumber, 5)))),
    ...(minInterval > 0 ? { minInterval } : {}),
    ...(maxInterval > 0 ? { maxInterval } : {}),
  };
}

/** (rows, chartType, options) → ECharts option (방식 A 모사, MVP 옵션 범위) */
export function assembleOption(
  result: QueryResult,
  chartType: ChartType,
  options: Record<string, any>,
  builderConfig: Record<string, any> | null = null,
): Record<string, unknown> {
  // Java 변환기와 동일하게 저장 옵션 마이그레이션과 대분류 기본값 병합을 변환기 진입점에서 수행한다.
  // 호출자가 부분 저장 옵션을 넘겨도 MSW 미리보기와 실제 서버가 같은 결과를 내야 한다.
  const o = optionsWithDefaults(chartType as MajorType, options ?? {});
  const fieldLabels = seriesDisplayNames(builderConfig, result.columns);
  const xField = String(builderConfig?.xAxis ?? '').trim();
  const fieldSnapshots = builderConfig?.fieldDisplayNames;
  const hasSnapshot = (fieldRef: unknown) => {
    const reference = String(fieldRef ?? '').trim();
    return Boolean(
      reference
      && fieldSnapshots
      && typeof fieldSnapshots === 'object'
      && !Array.isArray(fieldSnapshots)
      && String(fieldSnapshots[reference] ?? '').trim(),
    );
  };
  if (xField && hasSnapshot(xField) && !String(o.xAxis?.title ?? '').trim()) {
    o.xAxis = { ...(o.xAxis ?? {}), title: fieldDisplayName(builderConfig, xField, result.columns[0]?.name ?? 'X') };
  }
  const measures = Array.isArray(builderConfig?.yAxis) ? builderConfig.yAxis : [];
  if (measures.length === 1 && hasSnapshot(measures[0]?.column) && !String(o.yAxis?.title ?? '').trim()) {
    o.yAxis = {
      ...(o.yAxis ?? {}),
      title: measureDisplayName(builderConfig, measures[0], result.columns[1]?.name ?? '값'),
    };
  }
  const movingAverage = movingAverageOf(o.analysis?.movingAverage);
  const movingAverageEligible = movingAverageOverridesSort(chartType, o, result.columns);
  // 이동평균은 sortOrder 대신 시간 오름차순을 강제한다(서버 변환기와 동일).
  const displayRows = movingAverageEligible
    ? sortRowsByTime(result.rows)
    : applySort(result.rows, o.sortOrder);
  const itemColors = itemColorLookup(o.itemColorOverrides);
  const cats = displayRows.map((r) => r[0]);
  const seriesCols = result.columns.slice(1);
  const palette = orderedPalette(o.palette ?? DEFAULT_PALETTE, o.paletteActiveIndex, o.paletteReversed);
  const variant: string = o.variant ?? (chartType === 'pie' ? 'pie' : chartType === 'scatter' ? 'scatter' : chartType === 'line' ? 'basic' : 'basic');
  const bubbleCandidate = chartType === 'scatter' && variant === 'bubble'
    ? result.columns.findIndex((column) => column.name === o.scatter?.bubbleField)
    : -1;
  const bubbleColumnIndex = bubbleCandidate > 1 ? bubbleCandidate : -1;
  const scatterSeriesCols = chartType === 'scatter' && bubbleColumnIndex >= 0
    ? seriesCols.filter((_column, index) => index + 1 !== bubbleColumnIndex)
    : seriesCols;
  const geoSeriesIndex = result.columns.findIndex((column) => column.name === '__chartsdk_series');
  const colorNames = chartType === 'pie'
    ? cats.map((category) => String(category))
    : ((chartType === 'map' || chartType === 'geoscatter') && geoSeriesIndex >= 0)
      ? [...new Set(displayRows.map((row) => geoRowSeriesName(row, geoSeriesIndex, '미분류')))]
    : (chartType === 'scatter' ? scatterSeriesCols : seriesCols).map((column) => column.name);
  const autoColorMap = resolveSeriesColorMap(
    colorNames,
    palette,
    o.autoColorMap ?? {},
    isPalettePresetForFamily(o.palettePreset, 'sequential'),
  );
  const typography = resolveChartTypography(o);
  const metrics = resolveChartLayoutMetrics(o);
  const fonts = resolveChartFontFamilies(o);

  // 배경: 서버 변환기와 동일하게 불투명 기본(흰색) — 미리보기가 임베드 결과와 일치하도록.
  const opt: Record<string, any> = {
    color: palette,
    backgroundColor: o.backgroundColor ?? '#ffffff',
    __chartsdkAutoColorMap: autoColorMap,
    __chartsdkShowComputedAt: o.showComputedAt !== false,
    ...(Object.keys(fieldLabels).length > 0 ? { [SERIES_DISPLAY_NAMES_KEY]: fieldLabels } : {}),
    __chartsdkValueFormat: {
      tooltip: o.tooltip?.valueFormat ?? 'raw',
      yAxis: o.yAxis?.format ?? 'raw',
      unit: o.yAxis?.unit ?? '',
    },
  };

  if (o.title) {
    opt.title = {
      text: resolveChartTitleText(o),
      left: o.titleH ?? 'center',
      top: o.titleV ?? 'top',
      textStyle: chartTextStyle(typography.title, fonts.title),
    };
  }
  applyCommonTooltip(
    opt,
    o,
    chartType,
    result.columns,
    builderConfig,
    typography.tooltip,
    fonts.tooltip,
  );
  if (o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    // 제목이 같은 모서리면 범례를 제목 다음 줄로(규칙 1, 서버 미러).
    const titleTop = !!o.title && (o.titleV ?? 'top') === 'top';
    const offset = pos === 'top' ? (titleTop ? metrics.titleHeight : 0) : pos === 'bottom' ? (titleAtBottom(o) ? metrics.titleHeight : 0) : 0;
    const horizontalLegend = pos === 'top' || pos === 'bottom';
    opt.legend = {
      show: true,
      [pos]: offset,
      orient: horizontalLegend ? 'horizontal' : 'vertical',
      textStyle: chartTextStyle(typography.legend, fonts.legend),
      ...(horizontalLegend || o.legend?.scroll === true ? { type: 'scroll' } : {}),
    };
  } else {
    opt.legend = { show: false };
  }

  applyDataZoom(opt, o, chartType);

  // 0°는 ECharts 기본이라 내보내지 않는다(서버 미러).
  const labelRotate = typeof o.labelRotate === 'number' && o.labelRotate !== 0
    ? o.labelRotate
    : null;
  const label = {
    show: o.dataLabel === true,
    ...chartTextStyle(typography.dataLabel, fonts.dataLabel),
    ...(o.dataLabel === true && typeof o.labelPosition === 'string' ? { position: o.labelPosition } : {}),
    ...(o.dataLabel === true && labelRotate != null ? { rotate: labelRotate } : {}),
  };
  // 겹치는 데이터 라벨 자동 숨김(규칙 3, 공식 labelLayout).
  const labelLayout = o.dataLabel === true ? { hideOverlap: true } : undefined;
  const horizontal = variant === 'horizontal';

  // ── 상자수염 — 카테고리별 IQR 수염·사분위수와 별도 이상치, 선형보간(R-7) ──
  if (chartType === 'boxplot') {
    const groups = new Map<string, number[]>();
    for (const r of displayRows) {
      const cat = String(r[0] ?? '');
      const v = Number(r[1]);
      if (!Number.isFinite(v)) continue;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(v);
    }
    const cats = [...groups.keys()];
    opt.xAxis = {
      type: 'category',
      data: cats,
      boundaryGap: true,
      axisLabel: categoryAxisLabel(typography.axis, o.xAxis?.rotate, o.xAxis, 'all', true, fonts.axis),
      ...axisOptions(o.xAxis, typography.axis, 'x', 'x', fonts.axis),
    };
    opt.yAxis = {
      type: o.yAxis?.scale === 'log' ? 'log' : 'value',
      splitLine: { show: o.yAxis?.splitLine !== false },
      axisLabel: {
        ...chartTextStyle(typography.axis, fonts.axis),
        ...(o.yAxis?.unit ? { formatter: `{value}${o.yAxis.unit}` } : {}),
      },
      ...axisOptions(o.yAxis, typography.axis, 'y', 'y', fonts.axis),
      ...numericAxisOptions(o.yAxis, o.yAxis?.scale === 'log' ? 'log' : 'value', false),
      ...(o.yAxis?.rangeMode === 'manual' ? { min: o.yAxis?.min, max: o.yAxis?.max } : {}),
    };
    opt.grid = { ...gridMargins(o, true), containLabel: o.grid?.containLabel !== false };
    const seriesName = seriesCols[0]?.name ?? '산점도';
    const seriesColor = o.colorMap?.[seriesName] ?? autoColorMap[seriesName] ?? paletteColor(palette, 0);
    const summaries = cats.map((c) => boxplotSummary(groups.get(c)!));
    const series: Record<string, any> = {
      type: 'boxplot',
      name: seriesName,
      data: cats.map((c, index) => withMockItemColor(
        summaries[index].box,
        itemColorFor(itemColors, 'boxplot', seriesName, [c], 0),
        'color',
        true,
      )),
      itemStyle: { color: seriesColor, borderColor: seriesColor },
    };
    applySeriesEmphasis(series, o, 'boxplot');
    applyAnalysisAnnotations([series], o.analysis?.annotations, false, false);
    const allSeries = [series];
    const outlierConfig = boxplotOutliersOf(o.analysis?.boxplotOutliers);
    const outlierData = cats.flatMap((category, index) =>
      summaries[index].outliers.map((value) => [category, value]));
    if (outlierConfig.show && outlierData.length > 0) {
      const outliers: Record<string, any> = {
        id: BOXPLOT_OUTLIER_SERIES_ID,
        type: 'scatter',
        name: seriesName,
        data: outlierData,
        symbol: 'circle',
        symbolSize: 9,
        color: outlierConfig.color,
        itemStyle: { color: outlierConfig.color },
        z: 4,
      };
      applySeriesEmphasis(outliers, o, 'scatter');
      allSeries.push(outliers);
    }
    opt.series = allSeries;
    return opt;
  }

  // ── 히트맵 — X·Y 카테고리 매트릭스, 값=색(visualMap) ──
  if (chartType === 'heatmap') {
    const cats = displayRows.map((r) => String(r[0] ?? ''));
    const yNames = seriesCols.map((c) => c.name);
    const data: unknown[] = [];
    const occurrences = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    displayRows.forEach((r, xi) => {
      seriesCols.forEach((_c, s) => {
        const v = Number(r[1 + s]) || 0;
        const dimensions: ItemColorDimension[] = [cats[xi], yNames[s]];
        const occurrence = nextMockOccurrence(occurrences, 'heatmap', '', dimensions);
        data.push(withMockItemColor(
          [xi, s, v],
          itemColorFor(itemColors, 'heatmap', '', dimensions, occurrence),
          'color',
        ));
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (min === max) max = min + 1;
    delete opt.legend;
    opt.xAxis = {
      type: 'category',
      data: cats,
      splitArea: { show: true },
      axisLabel: categoryAxisLabel(typography.axis, o.xAxis?.rotate, o.xAxis, 'all', true, fonts.axis),
      ...axisOptions(o.xAxis, typography.axis, 'x', 'x', fonts.axis),
    };
    opt.yAxis = {
      type: 'category',
      data: yNames,
      ...(Object.keys(fieldLabels).length > 0 ? { [AXIS_DISPLAY_NAMES_KEY]: fieldLabels } : {}),
      splitArea: { show: true },
      axisLabel: categoryAxisLabel(typography.axis, undefined, o.yAxis, 'auto', false, fonts.axis),
      ...axisOptions(o.yAxis, typography.axis, 'y', 'y', fonts.axis),
    };
    const hm = gridMargins(o, false); // heatmap 은 범례 제거 → 제목만 가산
    opt.grid = { ...hm, bottom: hm.bottom + metrics.visualMapHeight, containLabel: o.grid?.containLabel !== false };
    opt.visualMap = visualMapConfig(
      min,
      max,
      palette,
      titleAtBottom(o) ? metrics.titleHeight : 0,
      typography.legend,
      fonts.legend,
      o.colorTheme?.version === 2,
    );
    const series: Record<string, any> = {
      type: 'heatmap',
      name: '값',
      data,
      label: {
        show: o.dataLabel === true,
        ...chartTextStyle(typography.dataLabel, fonts.dataLabel),
        ...(o.dataLabel === true && labelRotate != null ? { rotate: labelRotate } : {}),
      },
    };
    applySeriesEmphasis(series, o, 'heatmap');
    opt.series = [series];
    return opt;
  }

  // ── 영역 지도 — 지역·Polygon 값을 seriesBy별 map 계열로 분리 ──
  if (chartType === 'map' && variant !== 'heatmap') {
    const nameIndex = result.columns.findIndex((column) => column.name === '__chartsdk_area_name');
    const valueIndex = result.columns.findIndex((column) => column.name === '__chartsdk_area_value');
    const geometryIndex = result.columns.findIndex((column) => column.name === '__chartsdk_geojson');
    const seriesIndex = result.columns.findIndex((column) => column.name === '__chartsdk_series');
    const spatial = geometryIndex >= 0;
    const bySeries = new Map<string, unknown[]>();
    const occurrences = new Map<string, number>();
    const values: number[] = [];
    const featureByName = new Map<string, Record<string, unknown>>();
    displayRows.forEach((row) => {
      const name = String(row[nameIndex >= 0 ? nameIndex : 0] ?? '');
      const value = Number(row[valueIndex >= 0 ? valueIndex : 1]) || 0;
      const legacyValueName = valueIndex < 0 ? result.columns[1]?.name : undefined;
      const seriesName = geoRowSeriesName(row, seriesIndex, legacyValueName || '값');
      const dimensions: ItemColorDimension[] = [name];
      const occurrence = nextMockOccurrence(occurrences, 'map', seriesName, dimensions);
      const item = withMockItemColor(
        { name, value },
        itemColorFor(itemColors, 'map', seriesName, dimensions, occurrence),
        'areaColor',
      );
      const current = bySeries.get(seriesName) ?? [];
      current.push(item);
      bySeries.set(seriesName, current);
      values.push(value);
      if (spatial && !featureByName.has(name)) {
        try {
          const geometry = JSON.parse(String(row[geometryIndex] ?? '')) as Record<string, unknown>;
          if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
            featureByName.set(name, { type: 'Feature', properties: { name }, geometry });
          }
        } catch { /* 유효하지 않은 mock geometry는 제외 */ }
      }
    });
    if (bySeries.size === 0) bySeries.set('값', []);
    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (min === max) max = min + 1;
    let mapName = o.map?.name === 'kr-sigungu' ? 'kr-sigungu' : 'kr-sido';
    if (spatial) {
      const features = [...featureByName.values()];
      const fingerprint = JSON.stringify(features);
      let hash = 2166136261;
      for (let i = 0; i < fingerprint.length; i++) hash = Math.imul(hash ^ fingerprint.charCodeAt(i), 16777619);
      mapName = `chartsdk-dynamic-mock-${(hash >>> 0).toString(16)}`;
      opt[EMBEDDED_MAPS_KEY] = [{ name: mapName, geoJSON: { type: 'FeatureCollection', features } }];
    }
    const mapSeries = [...bySeries.entries()].map(([name, data], index) => {
      const id = `__chartsdk_geo_map_${index}`;
      const series: Record<string, any> = {
        id,
        type: 'map',
        name,
        map: mapName,
        roam: o.map?.roam === true,
        itemStyle: {
          areaColor: o.colorMap?.[name] ?? autoColorMap[name] ?? paletteColor(palette, index),
        },
        label: {
          show: o.dataLabel === true,
          ...chartTextStyle(typography.dataLabel, fonts.dataLabel),
          ...(o.dataLabel === true && labelRotate != null ? { rotate: labelRotate } : {}),
        },
        ...(o.dataLabel === true ? { labelLayout: { hideOverlap: true } } : {}),
        ...nonCartesianInsets(o, bySeries.size > 1, true),
        data,
      };
      applySeriesEmphasis(series, o, 'map');
      return series;
    });
    if (mapSeries.length <= 1) delete opt.legend;
    opt.visualMap = visualMapConfig(
      min, max, palette, titleAtBottom(o) ? metrics.titleHeight : 0,
      typography.legend, fonts.legend, o.colorTheme?.version === 2,
      mapSeries.map((series) => ({ seriesId: String(series.id), dimension: 0 })),
    );
    opt.series = mapSeries;
    opt[MAP_VIEWPORT_KEY] = o.map?.viewport ?? { mode: 'data' };
    return opt;
  }

  // ── map/heatmap 및 point/scatter·effectScatter — 공용 geo 역할 열 ──
  if (chartType === 'geoscatter' || (chartType === 'map' && variant === 'heatmap')) {
    const longitudeFound = result.columns.findIndex((column) => column.name === '__chartsdk_longitude');
    const longitudeIndex = Math.max(0, longitudeFound);
    const latitudeFound = result.columns.findIndex((column) => column.name === '__chartsdk_latitude');
    const latitudeIndex = latitudeFound >= 0 ? latitudeFound : 1;
    const nameIndex = result.columns.findIndex((column) => column.name === '__chartsdk_point_name');
    const valueIndex = result.columns.findIndex((column) => column.name === '__chartsdk_point_value');
    let sizeIndex = result.columns.findIndex((column) => column.name === '__chartsdk_size');
    if (chartType === 'geoscatter' && (longitudeFound < 0 || latitudeFound < 0)
      && sizeIndex < 0 && result.columns.length > 2) sizeIndex = 2;
    const seriesIndex = result.columns.findIndex((column) => column.name === '__chartsdk_series');
    const base = typeof o.geoscatter?.symbolSize === 'number' ? o.geoscatter.symbolSize : 10;
    const sizes = sizeIndex >= 0 ? displayRows.map((row) => Number(row[sizeIndex])).filter(Number.isFinite) : [];
    const sizeMin = sizes.length ? Math.min(...sizes) : 0;
    const sizeMax = sizes.length ? Math.max(...sizes) : 1;
    const sizeOf = (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || sizeMin === sizeMax) return base;
      return Math.round(6 + 22 * Math.sqrt((numeric - sizeMin) / (sizeMax - sizeMin)));
    };
    const bySeries = new Map<string, unknown[]>();
    const visualValues: number[] = [];
    const occurrences = new Map<string, number>();
    displayRows.forEach((row) => {
      const longitude = Number(row[longitudeIndex]) || 0;
      const latitude = Number(row[latitudeIndex]) || 0;
      const seriesName = geoRowSeriesName(row, seriesIndex, chartType === 'map' ? '밀도' : '포인트');
      const pointName = nameIndex >= 0 && row[nameIndex] != null
        ? String(row[nameIndex])
        : `${roundMockCoordinate(longitude)}, ${roundMockCoordinate(latitude)}`;
      const value = valueIndex >= 0 ? row[valueIndex] : chartType === 'map' ? 1 : null;
      const intensity = chartType === 'map' && typeof value === 'number' && Number.isFinite(value) ? value : 1;
      if (chartType === 'map') visualValues.push(intensity);
      const dimensions: ItemColorDimension[] = [roundMockCoordinate(longitude), roundMockCoordinate(latitude)];
      const occurrence = nextMockOccurrence(occurrences, 'geoscatter', seriesName, dimensions);
      const itemColor = itemColorFor(itemColors, 'geoscatter', seriesName, dimensions, occurrence);
      const point: Record<string, unknown> = {
        name: pointName,
        value: chartType === 'map'
          ? [longitude, latitude, intensity]
          : [longitude, latitude, value, sizeIndex >= 0 ? row[sizeIndex] : null],
        ...(chartType === 'geoscatter' && sizeIndex >= 0 ? { symbolSize: sizeOf(row[sizeIndex]) } : {}),
      };
      const current = bySeries.get(seriesName) ?? [];
      current.push(withMockItemColor(point, itemColor, 'color'));
      bySeries.set(seriesName, current);
    });
    if (bySeries.size === 0) bySeries.set(chartType === 'map' ? '밀도' : '포인트', []);
    const boundary = o.map?.boundary ?? {};
    const boundaryItemStyle: Record<string, unknown> = {};
    if (typeof boundary.areaColor === 'string') boundaryItemStyle.areaColor = boundary.areaColor;
    if (typeof boundary.borderColor === 'string') boundaryItemStyle.borderColor = boundary.borderColor;
    if (typeof boundary.borderWidth === 'number') {
      boundaryItemStyle.borderWidth = clampNumber(boundary.borderWidth, 0, 20, 5);
    }
    opt.geo = {
      map: o.map?.name === 'kr-sigungu' ? 'kr-sigungu' : 'kr-sido',
      roam: o.map?.roam === true,
      clip: true,
      ...nonCartesianInsets(o, bySeries.size > 1, chartType === 'map'),
      label: { show: false },
      ...(boundary.show === false ? { show: false } : {}),
      ...(boundary.show !== false && Object.keys(boundaryItemStyle).length > 0
        ? { itemStyle: boundaryItemStyle }
        : {}),
      emphasis: { disabled: true },
    };
    const pointSeries = [...bySeries.entries()].map(([name, data], index) => {
      const type = chartType === 'map' ? 'heatmap' : variant === 'effectScatter' ? 'effectScatter' : 'scatter';
      const id = chartType === 'map'
        ? `__chartsdk_geo_heatmap_${index}`
        : `__chartsdk_geo_point_${index}`;
      const series: Record<string, any> = {
        id,
        type,
        coordinateSystem: 'geo',
        name,
        ...(type === 'heatmap' ? {} : { clip: true }),
        ...(type === 'heatmap'
          ? {
              pointSize: o.map?.heatmapPointSize ?? 20,
              blurSize: o.map?.heatmapBlurSize ?? 30,
              minOpacity: o.map?.heatmapMinOpacity ?? 0,
              maxOpacity: o.map?.heatmapMaxOpacity ?? 1,
            }
          : {
              symbol: o.geoscatter?.symbol ?? 'circle',
              symbolSize: base,
              itemStyle: {
                color: o.colorMap?.[name] ?? o.autoColorMap?.[name] ?? paletteColor(palette, index),
                opacity: o.geoscatter?.opacity ?? 1,
                borderColor: o.geoscatter?.borderColor ?? '#FFFFFF',
                borderWidth: o.geoscatter?.borderWidth ?? 0,
              },
              label: {
                show: o.dataLabel === true,
                formatter: '{b}',
                ...chartTextStyle(typography.dataLabel, fonts.dataLabel),
                ...(o.dataLabel === true && labelRotate != null ? { rotate: labelRotate } : {}),
              },
              ...(o.dataLabel === true ? { labelLayout: { hideOverlap: true } } : {}),
              ...(type === 'effectScatter'
                ? {
                    showEffectOn: o.geoscatter?.showEffectOn ?? 'render',
                    rippleEffect: {
                      scale: o.geoscatter?.rippleScale ?? 2.5,
                      period: o.geoscatter?.ripplePeriod ?? 4,
                      brushType: o.geoscatter?.rippleBrushType ?? 'fill',
                    },
                  }
                : {}),
            }),
        data,
      };
      applySeriesEmphasis(series, o, type === 'heatmap' ? 'heatmap' : 'scatter');
      return series;
    });
    if (pointSeries.length <= 1) delete opt.legend;
    if (chartType === 'map') {
      let min = visualValues.length ? Math.min(...visualValues) : 0;
      let max = visualValues.length ? Math.max(...visualValues) : 1;
      if (min === max) max = min + 1;
      opt.visualMap = visualMapConfig(
        min, max, palette, titleAtBottom(o) ? metrics.titleHeight : 0,
        typography.legend, fonts.legend, o.colorTheme?.version === 2,
        pointSeries.map((series) => ({ seriesId: String(series.id), dimension: 2 })),
      );
    } else {
      delete opt.visualMap;
    }
    opt.series = pointSeries;
    opt[MAP_VIEWPORT_KEY] = o.map?.viewport ?? { mode: 'data' };
    return opt;
  }

  if (chartType === 'pie') {
    const occurrences = new Map<string, number>();
    const series: Record<string, any> = {
        type: 'pie',
        ...(variant === 'donut'
          ? { radius: [`${100 - (o.pie?.donutWidth ?? 40)}%`, '100%'] }
          : {}),
        ...nonCartesianInsets(o, true),
        roseType: variant === 'rose' ? 'radius' : undefined,
        startAngle: o.pie?.startAngle,
        minAngle: o.pie?.minAngle,
        label: {
          show: o.dataLabel === true,
          position: o.pie?.labelPosition ?? 'outside',
          ...chartTextStyle(typography.dataLabel, fonts.dataLabel),
          ...(o.dataLabel === true && labelRotate != null ? { rotate: labelRotate } : {}),
        },
        data: cats.map((name, i) => {
          const dimensions: ItemColorDimension[] = [colorDimension(name)];
          const occurrence = nextMockOccurrence(occurrences, 'pie', '', dimensions);
          return withMockItemColor(
            { name, value: displayRows[i][1], itemStyle: { color: o.colorMap?.[String(name)] ?? autoColorMap[String(name)] } },
            itemColorFor(itemColors, 'pie', '', dimensions, occurrence),
            'color',
          );
        }),
    };
    applySeriesEmphasis(series, o, 'pie');
    opt.series = [series];
    return opt;
  }

  if (chartType === 'scatter') {
    const xAxisType = o.xAxis?.scale === 'log' ? 'log' : 'value';
    const yAxisType = o.yAxis?.scale === 'log' ? 'log' : 'value';
    opt.xAxis = {
      type: xAxisType,
      splitLine: { show: o.xAxis?.splitLine === true },
      axisLabel: chartTextStyle(typography.axis, fonts.axis),
      ...axisOptions(o.xAxis, typography.axis, 'x', 'x', fonts.axis),
      ...numericAxisOptions(o.xAxis, xAxisType, true),
      ...(o.xAxis?.min != null ? { min: o.xAxis.min } : {}),
      ...(o.xAxis?.max != null ? { max: o.xAxis.max } : {}),
    };
    opt.yAxis = {
      type: yAxisType,
      splitLine: { show: o.yAxis?.splitLine !== false },
      axisLabel: {
        ...chartTextStyle(typography.axis, fonts.axis),
        ...(o.yAxis?.unit ? { formatter: `{value}${o.yAxis.unit}` } : {}),
      },
      ...axisOptions(o.yAxis, typography.axis, 'y', 'y', fonts.axis),
      ...numericAxisOptions(o.yAxis, yAxisType, false),
      ...(o.yAxis?.rangeMode === 'manual' ? { min: o.yAxis?.min, max: o.yAxis?.max } : {}),
    };
    opt.grid = { ...gridMargins(o, true), containLabel: o.grid?.containLabel !== false };
    const bubbleSizes = bubbleColumnIndex >= 0
      ? displayRows.map((row) => Number(row[bubbleColumnIndex])).filter(Number.isFinite)
      : [];
    const bubbleMin = bubbleSizes.length ? Math.min(...bubbleSizes) : 0;
    const bubbleMax = bubbleSizes.length ? Math.max(...bubbleSizes) : 1;
    const bubbleBaseSize = typeof o.scatter?.symbolSize === 'number' ? o.scatter.symbolSize : 10;
    const bubbleSizeOf = (value: unknown) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || bubbleMax === bubbleMin) return bubbleBaseSize;
      const ratio = Math.max(0, Math.min(1, (numeric - bubbleMin) / (bubbleMax - bubbleMin)));
      return Math.round(6 + 22 * Math.sqrt(ratio));
    };
    opt.series = scatterSeriesCols.map((c) => {
      const sourceIndex = result.columns.findIndex((column) => column.name === c.name);
      const occurrences = new Map<string, number>();
      const series: Record<string, any> = {
        type: 'scatter',
        name: c.name,
        ...(bubbleColumnIndex < 0 ? { symbolSize: o.scatter?.symbolSize ?? 10 } : {}),
        symbol: o.scatter?.symbol ?? 'circle',
        data: displayRows.map((r) => {
          const x = Number(r[0]) || 0;
          const y = Number(r[sourceIndex]) || 0;
          const dimensions: ItemColorDimension[] = [x, y];
          const occurrence = nextMockOccurrence(occurrences, 'scatter', c.name, dimensions);
          const value: unknown = bubbleColumnIndex >= 0
            ? {
                value: [x, y, r[bubbleColumnIndex]],
                symbolSize: bubbleSizeOf(r[bubbleColumnIndex]),
              }
            : [x, y];
          return withMockItemColor(
            value,
            itemColorFor(itemColors, 'scatter', c.name, dimensions, occurrence),
            'color',
          );
        }),
        label,
        labelLayout,
        color: o.colorMap?.[c.name] ?? autoColorMap[c.name],
        itemStyle: { color: o.colorMap?.[c.name] ?? autoColorMap[c.name] },
      };
      applySeriesEmphasis(series, o, 'scatter');
      return series;
    });
    applyAnalysisAnnotations(opt.series, o.analysis?.annotations, false, true);
    return opt;
  }

  // bar / line (직교)
  const catAxis = {
    type: 'category',
    data: cats,
    splitLine: { show: o.xAxis?.splitLine === true },
    axisLabel: categoryAxisLabel(typography.axis, o.xAxis?.rotate, o.xAxis, 'all', true, fonts.axis),
    ...axisOptions(o.xAxis, typography.axis, 'x', horizontal ? 'y' : 'x', fonts.axis),
  };
  const valAxis = {
    type: o.yAxis?.scale === 'log' ? 'log' : 'value',
    splitLine: { show: o.yAxis?.splitLine !== false },
    axisLabel: {
      ...chartTextStyle(typography.axis, fonts.axis),
      ...(o.yAxis?.unit ? { formatter: `{value}${o.yAxis.unit}` } : {}),
    },
    ...axisOptions(o.yAxis, typography.axis, 'y', horizontal ? 'x' : 'y', fonts.axis),
    ...numericAxisOptions(o.yAxis, o.yAxis?.scale === 'log' ? 'log' : 'value', false),
    ...(o.yAxis?.rangeMode === 'manual' ? { min: o.yAxis?.min, max: o.yAxis?.max } : {}),
  };
  opt.xAxis = horizontal ? valAxis : catAxis;
  if (!horizontal && o.yAxis?.secondAxis === true) {
    const primaryPosition = axisPosition(o.yAxis, 'y', 'y');
    opt.yAxis = [
      valAxis,
      { ...valAxis, position: primaryPosition === 'right' ? 'left' : 'right' },
    ];
  } else {
    opt.yAxis = horizontal ? catAxis : valAxis;
  }
  opt.grid = { ...gridMargins(o, true, horizontal), containLabel: o.grid?.containLabel !== false };

  const stack = variant === 'stacked' || variant === 'stackedArea' ? 'total' : undefined;
  // 100% 정규화(누적 막대) — 카테고리(행)별 합으로 나눠 각 카테고리 스택이 1이 되게 (서버 변환기와 동일).
  const normalize = chartType === 'bar' && variant === 'stacked' && !!o.bar?.normalize;
  const rowTotals = normalize
    ? displayRows.map((r) => seriesCols.reduce((sum, _c, si) => sum + (Number(r[1 + si]) || 0), 0))
    : null;
  // 혼합(combo): 시리즈별 type 오버라이드 (서버 변환기와 동일).
  const seriesTypeMap: Record<string, any> = o.seriesTypes && typeof o.seriesTypes === 'object' ? o.seriesTypes : {};
  opt.series = seriesCols.map((c, s) => {
    const seriesType = seriesTypeMap[c.name] === 'bar' || seriesTypeMap[c.name] === 'line' ? seriesTypeMap[c.name] : chartType;
    const occurrences = new Map<string, number>();
    const base: Record<string, any> = {
      type: seriesType,
      name: c.name,
      data: displayRows.map((r, ri) => {
        const v = Number(r[1 + s]) || 0;
        const itemValue = rowTotals && rowTotals[ri] ? v / rowTotals[ri] : v;
        const dimensions: ItemColorDimension[] = [colorDimension(r[0])];
        const occurrence = nextMockOccurrence(occurrences, 'cartesian', c.name, dimensions);
        return withMockItemColor(
          itemValue,
          itemColorFor(itemColors, 'cartesian', c.name, dimensions, occurrence),
          'color',
        );
      }),
      label,
      labelLayout,
      stack,
      color: o.colorMap?.[c.name] ?? autoColorMap[c.name],
      itemStyle: { color: o.colorMap?.[c.name] ?? autoColorMap[c.name] },
    };
    if (!horizontal && o.yAxis?.secondAxis === true && s >= 1) base.yAxisIndex = 1;
    if (seriesType === 'bar') {
      if (o.bar?.width != null) base.barWidth = `${o.bar.width}%`;
      if (o.bar?.gap != null) base.barGap = `${o.bar.gap}%`;
      if (typeof o.bar?.borderRadius === 'number') {
        base.itemStyle = { ...base.itemStyle, borderRadius: o.bar.borderRadius };
      }
      if (o.bar?.showBackground) base.showBackground = true;
    }
    if (seriesType === 'line') {
      if (variant === 'smooth') base.smooth = true;
      base.step = variant === 'step' ? 'end' : undefined;
      if (variant === 'area' || variant === 'stackedArea') base.areaStyle = { opacity: o.line?.areaOpacity ?? 0.3 };
      base.lineStyle = { width: o.line?.width ?? 2, type: o.line?.lineType ?? 'solid', color: o.colorMap?.[c.name] ?? autoColorMap[c.name] };
      base.showSymbol = o.line?.showSymbol !== false;
      base.symbolSize = o.line?.symbolSize ?? 4;
      base.connectNulls = o.line?.connectNulls === true;
    }
    applySeriesEmphasis(base, o, seriesType);
    return base;
  });
  applyAnalysisAnnotations(opt.series, o.analysis?.annotations, horizontal, false);
  if (movingAverageEligible) {
    appendMovingAverage(opt, o, displayRows, seriesCols, movingAverage);
  }
  return opt;
}

function appendMovingAverage(
  option: Record<string, any>,
  options: Record<string, any>,
  rows: Rows,
  seriesColumns: Cols,
  config: ReturnType<typeof movingAverageOf>,
): void {
  if (seriesColumns.length === 0 || option.series.length === 0) return;
  const seriesIndex = Math.min(config.seriesIndex, seriesColumns.length - 1);
  const sourceSeries = option.series[seriesIndex] as Record<string, any>;
  const values = simpleMovingAverage(rows, seriesIndex + 1, config.period);
  if (!values.some((value) => value != null)) return;

  const sourceColor = sourceSeries.lineStyle?.color
    ?? sourceSeries.color
    ?? sourceSeries.itemStyle?.color;
  const sourceName = seriesColumns[seriesIndex].name;
  const averageName = `${sourceName} · ${config.period}기간 이동평균`;
  const averageSeries: Record<string, any> = {
    id: `${MOVING_AVERAGE_SERIES_ID}_${seriesIndex}`,
    type: 'line',
    name: averageName,
    data: values,
    showSymbol: false,
    symbol: 'none',
    smooth: false,
    connectNulls: false,
    lineStyle: {
      width: 2,
      type: 'dashed',
      ...(sourceColor ? { color: sourceColor } : {}),
    },
    ...(sourceColor ? { color: sourceColor, itemStyle: { color: sourceColor } } : {}),
    ...(sourceSeries.yAxisIndex != null ? { yAxisIndex: sourceSeries.yAxisIndex } : {}),
    z: 4,
  };
  applySeriesEmphasis(averageSeries, options, 'line');
  const originalSeries = [...option.series];
  option.series.push(averageSeries);
  const displayNames = option[SERIES_DISPLAY_NAMES_KEY] as Record<string, string> | undefined;
  if (displayNames?.[sourceName]) {
    option[SERIES_DISPLAY_NAMES_KEY] = {
      ...displayNames,
      [averageName]: `${displayNames[sourceName]} · ${config.period}기간 이동평균`,
    };
  }

  applyMovingAverageLegend(option, originalSeries, config.showInLegend);
}

/** 이동평균 범례 제외는 이미 조립된 범례만 수정하며, 없는 legend 컴포넌트를 만들지 않는다. */
export function applyMovingAverageLegend(
  option: Record<string, any>,
  originalSeries: Array<Record<string, any>>,
  showInLegend: boolean,
): void {
  if (showInLegend || !option.legend || option.legend.show === false) return;
  option.legend = {
    ...option.legend,
    data: uniqueSeriesNames(originalSeries),
  };
}

function simpleMovingAverage(rows: Rows, valueIndex: number, period: number): Array<number | null> {
  return rows.map((_row, index) => {
    if (index < period - 1) return null;
    let sum = 0;
    for (let offset = index - period + 1; offset <= index; offset += 1) {
      const value = finiteObservation(rows[offset]?.[valueIndex]);
      if (value == null) return null;
      sum += value;
    }
    return sum / period;
  });
}

function finiteObservation(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function uniqueSeriesNames(series: Array<Record<string, any>>): string[] {
  return [...new Set(series.map((item) => String(item.name ?? '')).filter(Boolean))];
}

/** @sort — 서버 `ChartOptionConverter.applySort` 미러. 두 번째 컬럼 숫자 기준 안정 정렬. */
function applySort(rows: Rows, sortOrder: unknown): Rows {
  if (rows.length === 0 || (sortOrder !== 'asc' && sortOrder !== 'desc')) return rows;
  const sign = sortOrder === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => sign * compareSortValue(sortValueOf(left), sortValueOf(right)));
}

/** 숫자가 아닌 값은 Java `num()` 과 같이 최솟값으로 취급한다. */
function sortValueOf(row: unknown[]): number {
  return typeof row[1] === 'number' ? row[1] : Number.NEGATIVE_INFINITY;
}

/** Java `Double.compare` 와 같이 NaN 을 가장 큰 값으로 둔다. */
function compareSortValue(left: number, right: number): number {
  if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;
  if (Number.isNaN(right)) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortRowsByTime(rows: Rows): Rows {
  return rows
    .map((row, index) => ({ row, index, time: temporalValue(row[0]) }))
    .sort((a, b) => {
      if (a.time == null && b.time == null) return a.index - b.index;
      if (a.time == null) return 1;
      if (b.time == null) return -1;
      return a.time - b.time || a.index - b.index;
    })
    .map(({ row }) => row);
}

function temporalValue(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  const timeOnly = timeOnlyValue(normalized);
  if (timeOnly != null) return timeOnly;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Java LocalTime.parse와 같은 시간 단독 ISO 표현을 자정 이후 밀리초로 바꾼다. */
function timeOnlyValue(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = match[4] ? Math.floor(Number(`0.${match[4]}`) * 1_000) : 0;
  return ((hour * 60 + minute) * 60 + second) * 1_000 + milliseconds;
}

function applyAnalysisAnnotations(
  series: Array<Record<string, any>>,
  value: unknown,
  horizontal: boolean,
  numericX: boolean,
): void {
  if (series.length === 0) return;
  const annotations = analysisAnnotationsOf(value);
  const valueAxisKey = horizontal ? 'xAxis' : 'yAxis';

  for (const raw of annotations.lines.slice(0, MAX_ANALYSIS_ANNOTATIONS_PER_KIND)) {
    const lineValue = markerNumber(raw.value);
    if (lineValue == null) continue;
    const target = markerSeries(series, raw.seriesIndex);
    const markLine = target.markLine ?? {
      silent: true,
      symbol: ['none', 'none'],
      data: [],
    };
    const name = annotationName(raw.name);
    markLine.data.push({
      name,
      [valueAxisKey]: lineValue,
      lineStyle: {
        color: markerColor(raw.color, '#E53935'),
        type: markerLineType(raw.lineType),
        width: clampNumber(raw.lineWidth, 1, 8, 2),
      },
      label: {
        show: raw.showLabel !== false,
        formatter: annotationValueLabel(name, lineValue),
        position: 'insideEndTop',
      },
    });
    target.markLine = markLine;
  }

  for (const raw of annotations.ranges.slice(0, MAX_ANALYSIS_ANNOTATIONS_PER_KIND)) {
    const first = markerNumber(raw.min);
    const second = markerNumber(raw.max);
    if (first == null || second == null) continue;
    const min = Math.min(first, second);
    const max = Math.max(first, second);
    const target = markerSeries(series, raw.seriesIndex);
    const markArea = target.markArea ?? { silent: true, data: [] };
    const name = annotationName(raw.name);
    markArea.data.push([
      {
        name,
        [valueAxisKey]: min,
        itemStyle: {
          color: markerColor(raw.color, '#FFB000'),
          opacity: clampNumber(raw.opacity, 0.05, 0.6, 0.16),
        },
        label: {
          show: raw.showLabel !== false,
          formatter: annotationRangeLabel(name, min, max),
          position: 'insideTop',
        },
      },
      { [valueAxisKey]: max },
    ]);
    target.markArea = markArea;
  }

  for (const raw of annotations.targets.slice(0, MAX_ANALYSIS_ANNOTATIONS_PER_KIND)) {
    const targetValue = markerNumber(raw.value);
    const xValue = numericX ? markerNumber(raw.xValue) : categoryValue(raw.xValue);
    if (targetValue == null || xValue == null) continue;
    const target = markerSeries(series, raw.seriesIndex);
    const markPoint = target.markPoint ?? { silent: true, data: [] };
    const name = annotationName(raw.name);
    const color = markerColor(raw.color, '#D81B60');
    markPoint.data.push({
      name,
      value: targetValue,
      coord: horizontal ? [targetValue, xValue] : [xValue, targetValue],
      symbol: markerSymbol(raw.symbol),
      symbolSize: clampNumber(raw.symbolSize, 12, 80, 42),
      itemStyle: { color },
      label: {
        show: raw.showLabel !== false,
        formatter: annotationValueLabel(name, targetValue),
        position: 'top',
        color,
      },
    });
    target.markPoint = markPoint;
  }
}

function markerSeries(series: Array<Record<string, any>>, value: unknown): Record<string, any> {
  const requested = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return series[Math.max(0, Math.min(series.length - 1, requested))];
}

function markerNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function categoryValue(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function annotationName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function annotationValueLabel(name: string, value: number): string {
  return name ? `${name}: ${value}` : String(value);
}

function annotationRangeLabel(name: string, min: number, max: number): string {
  return name ? `${name}: ${min}–${max}` : `${min}–${max}`;
}

function markerColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

function markerLineType(value: unknown): 'solid' | 'dashed' | 'dotted' {
  return value === 'solid' || value === 'dotted' ? value : 'dashed';
}

function markerSymbol(value: unknown): 'pin' | 'diamond' | 'circle' {
  return value === 'diamond' || value === 'circle' ? value : 'pin';
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = markerNumber(value);
  return numeric == null ? fallback : Math.max(min, Math.min(max, numeric));
}

function itemColorLookup(value: unknown): Map<string, string> {
  return new Map(normalizeItemColorOverrides(value).map((item) => [itemColorTargetKey(item), item.color]));
}

function itemColorFor(
  lookup: Map<string, string>,
  kind: ItemColorKind,
  displayedSeriesName: string,
  dimensions: ItemColorDimension[],
  occurrence: number,
): string | undefined {
  return lookup.get(itemColorTargetKey({
    kind,
    seriesName: itemColorSeriesKey(kind, displayedSeriesName),
    dimensions,
    occurrence,
  }));
}

function nextMockOccurrence(
  seen: Map<string, number>,
  kind: ItemColorKind,
  displayedSeriesName: string,
  dimensions: ItemColorDimension[],
): number {
  const key = itemColorTargetKey({
    kind,
    seriesName: itemColorSeriesKey(kind, displayedSeriesName),
    dimensions,
    occurrence: 0,
  });
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);
  return occurrence;
}

function withMockItemColor(
  value: unknown,
  color: string | undefined,
  colorKey: 'color' | 'areaColor',
  matchBorderColor = false,
): unknown {
  if (!color) return value;
  const item: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : { value };
  const existingStyle = item.itemStyle && typeof item.itemStyle === 'object' && !Array.isArray(item.itemStyle)
    ? item.itemStyle as Record<string, unknown>
    : {};
  item.itemStyle = {
    ...existingStyle,
    [colorKey]: color,
    ...(matchBorderColor ? { borderColor: color } : {}),
  };
  return item;
}

function colorDimension(value: unknown): ItemColorDimension {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  return String(value);
}

function roundMockCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function orderedPalette(palette: string[], activeIndex: unknown, reversed: unknown): string[] {
  if (palette.length === 0) return DEFAULT_PALETTE;
  const start = typeof activeIndex === 'number' && Number.isFinite(activeIndex) ? Math.max(0, Math.round(activeIndex)) % palette.length : 0;
  const ordered = start <= 0 ? [...palette] : [...palette.slice(start), ...palette.slice(0, start)];
  return reversed === true ? ordered.reverse() : ordered;
}

function paletteColor(palette: string[], index: number): string {
  return palette[index % palette.length] ?? DEFAULT_PALETTE[0];
}

const DATA_ZOOM_CHART_TYPES = new Set(['bar', 'line', 'scatter', 'boxplot', 'heatmap']);

/**
 * 항상 활성화되는 휠 확대·축소(ECharts dataZoom type='inside') — 서버 변환기 미러.
 * 안쪽 방식이라 예약 높이가 0이고 제목·범례·grid 수식에 영향을 주지 않는다.
 * 과거 저장 축 설정은 보존하고, 설정이 없으면 차트 형태에 맞는 축을 자동 선택한다.
 */
function applyDataZoom(option: Record<string, any>, source: Record<string, any>, chartType: ChartType): void {
  if (!DATA_ZOOM_CHART_TYPES.has(chartType)) return;
  const storedAxis = source.dataZoom?.axis;
  const axis = storedAxis === 'x' || storedAxis === 'y' || storedAxis === 'both'
    ? storedAxis
    : chartType === 'scatter' || chartType === 'heatmap'
      ? 'both'
      : chartType === 'bar' && source.variant === 'horizontal'
        ? 'y'
        : 'x';
  const yAxisIndex = source.yAxis?.secondAxis === true ? [0, 1] : [0];
  option.dataZoom = [{
    type: 'inside',
    ...(axis !== 'y' ? { xAxisIndex: [0] } : {}),
    ...(axis !== 'x' ? { yAxisIndex } : {}),
    filterMode: 'filter',
  }];
}

function applyCommonTooltip(
  option: Record<string, any>,
  source: Record<string, any>,
  chartType: ChartType,
  columns: QueryResult['columns'],
  builderConfig: Record<string, any> | null,
  fontSize: number,
  fontFamily: string | null,
): void {
  const config = source.tooltip ?? {};
  const enabled = config.enabled !== false;
  // 툴팁은 HTML 렌더라 루트 textStyle 을 상속하지 않는다 — 글꼴을 따로 지정한다(서버 미러).
  const tooltip: Record<string, any> = { textStyle: { fontSize, ...(fontFamily ? { fontFamily } : {}) } };
  if (!enabled) tooltip.show = false;
  if (config.trigger === 'item' || config.trigger === 'axis') tooltip.trigger = config.trigger;
  if (config.axisPointer && config.axisPointer !== 'auto') tooltip.axisPointer = { type: config.axisPointer };
  if (config.confine === 'inside') tooltip.confine = true;
  if (config.confine === 'free') tooltip.confine = false;
  if (config.backgroundColor != null) tooltip.backgroundColor = config.backgroundColor;
  if (config.borderColor != null) tooltip.borderColor = config.borderColor;
  if (typeof config.borderWidth === 'number') tooltip.borderWidth = config.borderWidth;
  if (typeof config.padding === 'number') tooltip.padding = config.padding;
  if (config.textColor != null) tooltip.textStyle.color = config.textColor;
  option.tooltip = tooltip;

  if (enabled) {
    const fields = tooltipFieldsFor({
      chartType,
      columns,
      options: source,
      builderConfig,
    });
    option.__chartsdkTooltip = {
      mode: 'fields',
      chartType,
      fields: visibleTooltipFields(fields, config.fields),
      showSeriesColor: config.showSeriesColor !== false,
    };
  } else {
    delete option.__chartsdkTooltip;
  }
}

function putNested(target: Record<string, any>, group: string, key: string, value: unknown): void {
  target[group] = { ...(target[group] ?? {}), [key]: value };
}

function applySeriesEmphasis(series: Record<string, any>, source: Record<string, any>, seriesType: string): void {
  const config = source.emphasis ?? {};
  if (config.enabled === false) {
    series.emphasis = { disabled: true };
    return;
  }
  const emphasis: Record<string, any> = {};
  if (config.focus && config.focus !== 'auto') emphasis.focus = config.focus;
  if (['line', 'pie', 'scatter', 'boxplot'].includes(seriesType) && typeof config.scale === 'boolean') emphasis.scale = config.scale;
  if (seriesType === 'pie' && typeof config.scaleSize === 'number') emphasis.scaleSize = config.scaleSize;
  if (seriesType === 'line' && typeof config.lineWidth === 'number') putNested(emphasis, 'lineStyle', 'width', config.lineWidth);
  if (seriesType === 'boxplot' && typeof config.borderWidth === 'number') putNested(emphasis, 'itemStyle', 'borderWidth', config.borderWidth);
  if (config.colorMode === 'custom') {
    const color = config.color ?? '#FFD700';
    if (seriesType === 'map') {
      putNested(emphasis, 'itemStyle', 'areaColor', color);
    } else if (seriesType === 'line') {
      putNested(emphasis, 'itemStyle', 'color', color);
      putNested(emphasis, 'lineStyle', 'color', color);
    } else if (seriesType === 'boxplot') {
      putNested(emphasis, 'itemStyle', 'color', color);
      putNested(emphasis, 'itemStyle', 'borderColor', color);
    } else {
      putNested(emphasis, 'itemStyle', 'color', color);
    }
  }
  if (Object.keys(emphasis).length > 0) series.emphasis = emphasis;
}

function applyGeoEmphasis(geo: Record<string, any>, source: Record<string, any>): void {
  const config = source.emphasis ?? {};
  if (config.enabled === false) {
    geo.emphasis = { disabled: true };
    return;
  }
  const emphasis: Record<string, any> = {};
  if (config.focus && config.focus !== 'auto') emphasis.focus = config.focus;
  if (config.colorMode === 'custom') putNested(emphasis, 'itemStyle', 'areaColor', config.color ?? '#FFD700');
  if (Object.keys(emphasis).length > 0) geo.emphasis = emphasis;
}

function geoRowSeriesName(row: unknown[], seriesIndex: number, fallback: string): string {
  if (seriesIndex < 0 || row[seriesIndex] == null) return fallback;
  const value = String(row[seriesIndex]);
  return value.trim() === '' ? '미분류' : value;
}

/** 정렬된 배열에서 p 분위수 — R-7 선형보간(numpy/ECharts dataTool 기본). */
function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo] + (h - lo) * (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]);
}

type BoxplotSummary = {
  box: [number, number, number, number, number];
  outliers: number[];
};

/** 1.5 × IQR 수염과 범위 밖 이상치를 계산한다. */
function boxplotSummary(values: number[]): BoxplotSummary {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return { box: [0, 0, 0, 0, 0], outliers: [] };
  const q1 = quantileSorted(s, 0.25);
  const median = quantileSorted(s, 0.5);
  const q3 = quantileSorted(s, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const inliers = s.filter((value) => value >= lowerFence && value <= upperFence);
  return {
    box: [inliers[0] ?? q1, q1, median, q3, inliers[inliers.length - 1] ?? q3],
    outliers: s.filter((value) => value < lowerFence || value > upperFence),
  };
}

/** heatmap·map 공용 visualMap. v2는 순차형 전체 단계, 구 저장 데이터는 종전 2색 계약을 유지한다. */
function visualMapConfig(
  min: number,
  max: number,
  palette: string[],
  bottom = 0,
  fontSize = 12,
  fontFamily: string | null = null,
  continuousPalette = false,
  seriesTargets: { seriesId: string; dimension: number }[] = [],
): Record<string, unknown> {
  return {
    min,
    max,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom, // 제목이 하단이면 그 위로 올려 겹침 방지(규칙 1)
    textStyle: chartTextStyle(fontSize, fontFamily),
    ...(seriesTargets.length > 0 ? { seriesTargets } : {}),
    inRange: { color: continuousPalette ? [...palette] : ['#f7f7f7', paletteColor(palette, 0)] },
  };
}
