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
import { resolveChartLayoutMetrics, resolveChartTypography } from '@chartsdk/chart-options/display';
import { EMBEDDED_MAPS_KEY, MAP_VIEWPORT_KEY } from '@chartsdk/chart-options/geo';
import { schemaTables } from './seed';

type Cols = { name: string; type: string }[];
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
  const spatialGeoPoint = chartType === 'geoscatter' && cfg.geoPoint?.mode === 'spatial';
  const spatialGeoArea = chartType === 'map' && cfg.geoArea?.mode === 'spatial';
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
  if (spatialGeoArea) {
    if (!cfg.geoArea?.spatialColumn || !cfg.geoArea.nameColumn || !cfg.geoArea.valueColumn) return '';
    const area = qcol(cfg.geoArea.spatialColumn);
    const wgs84 = `ST_Transform((${area})::geometry, 4326)`;
    const selects = [
      `CAST(${qcol(cfg.geoArea.nameColumn)} AS text) AS ${qident('__chartsdk_area_name')}`,
      `${qcol(cfg.geoArea.valueColumn)} AS ${qident('__chartsdk_area_value')}`,
      `ST_AsGeoJSON(${wgs84}, 6) AS ${qident('__chartsdk_geojson')}`,
    ];
    const spatialWhere = where ? `${where} AND ${area} IS NOT NULL` : ` WHERE ${area} IS NOT NULL`;
    return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${spatialWhere}`;
  }
  if (spatialGeoPoint) {
    if (!cfg.geoPoint?.spatialColumn) return '';
    const point = qcol(cfg.geoPoint.spatialColumn);
    const wgs84 = `ST_Transform((${point})::geometry, 4326)`;
    const selects = [
      `ST_X(${wgs84}) AS ${qident('__chartsdk_longitude')}`,
      `ST_Y(${wgs84}) AS ${qident('__chartsdk_latitude')}`,
      ...(cfg.geoPoint.sizeColumn ? [`${qcol(cfg.geoPoint.sizeColumn)} AS ${qident('__chartsdk_size')}`] : []),
    ];
    const spatialWhere = where
      ? `${where} AND ${point} IS NOT NULL`
      : ` WHERE ${point} IS NOT NULL`;
    return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${spatialWhere}`;
  }
  if (!cfg.xAxis || cfg.yAxis.length === 0) return '';
  const rawMode = cfg.yAxis.some((y) => y.agg === 'none');
  if (rawMode) {
    const selects = [
      qcol(cfg.xAxis),
      ...(cfg.seriesBy ? [qcol(cfg.seriesBy)] : []),
      ...cfg.yAxis.map((y) => (aliasOf(y) === colName(y.column) ? qcol(y.column) : `${qcol(y.column)} AS ${qident(aliasOf(y))}`)),
    ];
    return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${where}${orderSql()}`;
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
  const plan = samplePlanForConfig(cfg);
  const approximate = plan?.approximate === true;

  // JOIN+WHERE 또는 VIEW 조회 결과를 먼저 확정한 뒤, 그 결과 행을 뽑고 마지막에 집계한다.
  if (plan?.approximate && plan.method === 'RESULT_RANDOM') {
    const population = qident('__chartsdk_population');
    const sample = qident('__chartsdk_sample');
    const nCte = qident('__chartsdk_n');
    const seedCte = qident('__chartsdk_seed');
    const xAlias = '__chartsdk_x';
    const yAliases = cfg.yAxis.map((_, i) => `__chartsdk_y_${i}`);
    const projected = [
      `${qcol(cfg.xAxis)} AS ${qident(xAlias)}`,
      ...(cfg.seriesBy ? [`${qcol(cfg.seriesBy)} AS ${qident('__chartsdk_series')}`] : []),
      ...cfg.yAxis.map((y, i) => `${qcol(y.column)} AS ${qident(yAliases[i])}`),
    ];
    const populationCte = `${population} AS (SELECT ${projected.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${where})`;
    const sampleBody = multi
      ? `SELECT * FROM ${population} USING SAMPLE reservoir(${plan.sampleSize} ROWS) REPEATABLE (${plan.seed})`
      : `SELECT ${population}.* FROM ${population} CROSS JOIN ${seedCte} ORDER BY random() LIMIT ${plan.sampleSize}`;
    const pgSeed = Math.max(-1, Math.min(1, ((plan.seed ?? DEFAULT_SAMPLE_SEED) / 2_147_483_647) * 2 - 1));
    const ctes = [
      ...(!multi ? [`${seedCte} AS MATERIALIZED (SELECT setseed(${pgSeed}) AS ${qident('seeded')})`] : []),
      populationCte,
      `${sample} AS MATERIALIZED (${sampleBody})`,
      `${nCte} AS (SELECT COUNT(*) AS ${qident('sampled')} FROM ${sample})`,
    ];
    const sampleX = qcol(`__chartsdk_sample.${xAlias}`);
    const xCol = cfg.xAxisBucket
      ? `DATE_TRUNC('${cfg.xAxisBucket}', ${sampleX}) AS ${qident(colName(cfg.xAxis))}`
      : `${sampleX} AS ${qident(colName(cfg.xAxis))}`;
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
      ...(cfg.seriesBy ? [`${qcol('__chartsdk_sample.__chartsdk_series')} AS ${qident(colName(cfg.seriesBy))}`] : []),
      ...cfg.yAxis.map((y, i) => `${aggSql[y.agg](qcol(`__chartsdk_sample.${yAliases[i]}`))} AS ${qident(aliasOf(y))}`),
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
  const xCol = cfg.xAxisBucket ? `DATE_TRUNC('${cfg.xAxisBucket}', ${xSource}) AS ${qident(colName(cfg.xAxis))}` : xSource;
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
    ...(cfg.seriesBy ? [sourceColumn(cfg.seriesBy)] : []),
    ...cfg.yAxis.map((y) => `${aggSql[y.agg](sourceColumn(y.column))} AS ${qident(aliasOf(y))}`),
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

/** 표본 비율 0.1~100, 소수점 한 자리 정규화 (생성규칙 3C·9장) */
export const clampRate = normalizeSampleRate;

function baseRelationForConfig(cfg: BuilderConfig): SchemaTable | undefined {
  if (!cfg.table) return undefined;
  return schemaTables.find((table) =>
    table.datasourceId === cfg.table!.datasourceId
    && table.schema === cfg.table!.schema
    && table.name === cfg.table!.name,
  );
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
  // JOIN 결과의 행수는 base reltuples로 대신하지 않는다. 별도 COUNT 없이 알 수 없으므로 미상(0)이다.
  const populationEstimate = resultPopulation ? 0 : relation?.estimatedRowCount ?? 0;
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
  const groups = labels.map((key, index) => ({
    key,
    sampleCount: uniformRandom
      ? Math.floor(sampleSize / Math.max(1, labels.length)) + (index < sampleSize % Math.max(1, labels.length) ? 1 : 0)
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
    sampledRowCount: groups.reduce((sum, group) => sum + group.sampleCount, 0),
    ...(uniformRandom ? { confidenceLevel: 0.95 } : {}),
    groups, estimates,
    warnings: [...warnings],
  };
}

// map 데모용 시·도 라벨 — kr-sido.json properties.name 과 정확히 일치해야 지도에 값이 칠해진다.
const SAMPLE_REGIONS = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '경기도', '강원도', '충청북도', '전라남도', '경상북도', '제주특별자치도'];

/** 집계 결과 rows 생성 — 카테고리/월 라벨 + yAxis별 가짜 값 */
export function buildAggregateRows(cfg: BuilderConfig, chartType?: ChartType): QueryResult {
  // 상자수염: 카테고리별로 원본값 여러 개(분포) — 변환기가 그룹핑해 5수 요약 계산.
  if (chartType === 'boxplot') {
    const valName = cfg.yAxis[0] ? colName(cfg.yAxis[0].column) : 'value';
    const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'category', type: 'text' }, { name: valName, type: 'numeric' }];
    const rows: Rows = [];
    SAMPLE_CATS.forEach((cat, ci) => {
      const center = 100 + ci * 45;
      const spread = 8 + ci * 3;
      for (let k = 0; k < 9; k++) rows.push([cat, Math.round(center + (k - 4) * spread + (k % 3) * 6)]);
    });
    return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 20 };
  }
  // 지도: 시·도 라벨 + 값 1개.
  if (chartType === 'map') {
    if (cfg.geoArea?.mode === 'spatial') {
      const columns: Cols = [
        { name: '__chartsdk_area_name', type: 'text' },
        { name: '__chartsdk_area_value', type: 'numeric' },
        { name: '__chartsdk_geojson', type: 'text' },
      ];
      const rows: Rows = SAMPLE_SPATIAL_AREAS.map(([name, value, geometry]) => [name, value, JSON.stringify(geometry)]);
      return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 20 };
    }
    const valName = cfg.yAxis[0] ? aliasOf(cfg.yAxis[0]) : 'value';
    const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'region', type: 'text' }, { name: valName, type: 'numeric' }];
    const sampling = samplingForConfig(cfg, SAMPLE_REGIONS);
    const rows: Rows = SAMPLE_REGIONS.map((rgn, i) => [
      rgn,
      Math.round(500 - i * 32 + (i % 3) * 45),
    ]);
    return {
      columns,
      rows,
      rowCount: rows.length,
      truncated: false,
      elapsedMs: sampling?.approximate ? 12 : 20,
      ...(sampling ? { sampling, approximate: sampling.approximate, sampleRate: legacySampleRate(sampling) } : {}),
    };
  if (cfg.seriesBy && (chartType === 'bar' || chartType === 'line')) {
    const years = ['2012', '2013', '2014', '2015'];
    const regions = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '경기도'];
    const columns: Cols = [
      { name: cfg.xAxis ? colName(cfg.xAxis) : 'region', type: 'text' },
      ...years.map((year) => ({ name: year, type: 'numeric' })),
    ];
    const rows: Rows = regions.map((region, regionIndex) => [
      region,
      ...years.map((_year, yearIndex) => 2_500_000 + regionIndex * 1_150_000 + yearIndex * 85_000),
    ]);
    return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 24 };
  }
  }
  // 지도 포인트: 대한민국 범위 내 경도·위도(+선택 크기값) 원본 좌표.
  if (chartType === 'geoscatter') {
    const spatial = cfg.geoPoint?.mode === 'spatial';
    const hasSize = spatial ? !!cfg.geoPoint?.sizeColumn : cfg.yAxis.length >= 2;
    const columns: Cols = [
      { name: spatial ? '__chartsdk_longitude' : cfg.xAxis ? colName(cfg.xAxis) : 'lng', type: 'numeric' },
      { name: spatial ? '__chartsdk_latitude' : cfg.yAxis[0] ? colName(cfg.yAxis[0].column) : 'lat', type: 'numeric' },
      ...(hasSize ? [{ name: spatial ? '__chartsdk_size' : colName(cfg.yAxis[1].column), type: 'numeric' }] : []),
    ];
    const rows: Rows = SAMPLE_SPATIAL_POINTS.map(([lng, lat, size]) =>
      hasSize ? [lng, lat, size] : [lng, lat]);
    return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 20 };
  }
  if (cfg.yAxis.some((y) => y.agg === 'none')) {
    const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'x', type: 'numeric' }, ...cfg.yAxis.map((y) => ({ name: aliasOf(y), type: 'numeric' }))];
    const rows: Rows = Array.from({ length: 12 }, (_, i) => [
      10 + i * 7,
      ...cfg.yAxis.map((_, j) => Math.round(40 + i * 9 + j * 15 + (i % 3) * 8)),
    ]);
    return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 18 };
  }
  const labels = cfg.xAxisBucket ? SAMPLE_MONTHS : SAMPLE_CATS;
  const columns: Cols = [{ name: cfg.xAxis ? colName(cfg.xAxis) : 'x', type: 'text' }, ...cfg.yAxis.map((y) => ({ name: aliasOf(y), type: 'numeric' }))];
  const sampling = samplingForConfig(cfg, labels);
  // sampling v6: 모든 집계값은 선택된 표본에서 계산한 값을 그대로 표시한다.
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
  const rawNumeric = cfg.yAxis.some((y) => y.agg === 'none');
  const columns: Cols = [
    { name: cfg.xAxis ? colName(cfg.xAxis) : 'category', type: rawNumeric ? 'numeric' : 'text' },
    ...cfg.yAxis.map((y) => ({ name: colName(y.column), type: 'numeric' })),
  ];
  const rows: Rows = Array.from({ length: 12 }, (_, i) => [
    rawNumeric ? 10 + i * 7 : SAMPLE_CATS[i % SAMPLE_CATS.length],
    ...cfg.yAxis.map((_, j) => Math.round(50 + i * 7 + j * 11)),
  ]);
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 18 };
}

/** 테이블 원본 미리보기(GET schema preview) — 컬럼 타입별 가짜 값 */
export function buildTablePreview(table: SchemaTable): QueryResult {
  const rows: Rows = Array.from({ length: 12 }, (_, i) => table.columns.map((c) => sampleValue(c.type, i)));
  return { columns: table.columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 12 };
}

const DEFAULT_PALETTE = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'];

const titleAtBottom = (o: any): boolean => !!o.title && (o.titleV ?? 'top') === 'bottom';
const presetBase = (preset?: string) =>
  preset === 'compact' ? { left: 8, right: 8, top: 8, bottom: 8 }
    : preset === 'loose' ? { left: 48, right: 48, top: 48, bottom: 48 }
      : { left: 24, right: 24, top: 28, bottom: 24 };
/** grid top/bottom 에 제목·범례 예약 높이 가산 (서버 applyMargins 미러). */
function gridMargins(o: any, includeLegend: boolean): { left: number; right: number; top: number; bottom: number } {
  const b = presetBase(o.grid?.preset);
  const metrics = resolveChartLayoutMetrics(o);
  if (!!o.title && (o.titleV ?? 'top') === 'top') b.top += metrics.titleHeight;
  if (titleAtBottom(o)) b.bottom += metrics.titleHeight;
  if (includeLegend && o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    if (pos === 'top') b.top += metrics.legendHeight;
    if (pos === 'bottom') b.bottom += metrics.legendHeight;
  }
  return b;
}

/** (rows, chartType, options) → ECharts option (방식 A 모사, MVP 옵션 범위) */
export function assembleOption(result: QueryResult, chartType: ChartType, options: Record<string, any>): Record<string, unknown> {
  const o = options ?? {};
  const cats = result.rows.map((r) => r[0]);
  const seriesCols = result.columns.slice(1);
  const palette = orderedPalette(o.palette ?? DEFAULT_PALETTE, o.paletteActiveIndex);
  const variant: string = o.variant ?? (chartType === 'pie' ? 'pie' : chartType === 'scatter' ? 'scatter' : chartType === 'line' ? 'basic' : 'basic');
  const typography = resolveChartTypography(o);
  const metrics = resolveChartLayoutMetrics(o);

  // 배경: 서버 변환기와 동일하게 불투명 기본(흰색) — 미리보기가 임베드 결과와 일치하도록.
  const opt: Record<string, any> = { color: palette, backgroundColor: o.backgroundColor ?? '#ffffff' };

  if (o.title) opt.title = { text: o.title, left: o.titleH ?? 'center', top: o.titleV ?? 'top', textStyle: { fontSize: typography.title } };
  const itemTooltip = chartType === 'pie' || chartType === 'scatter' || chartType === 'boxplot' || chartType === 'heatmap' || chartType === 'map';
  opt.tooltip = { trigger: o.tooltip?.trigger ?? (itemTooltip ? 'item' : 'axis'), confine: true, textStyle: { fontSize: typography.tooltip } };
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
      textStyle: { fontSize: typography.legend },
      ...(horizontalLegend || o.legend?.scroll === true ? { type: 'scroll' } : {}),
    };
  } else {
    opt.legend = { show: false };
  }

  const label = { show: o.dataLabel === true, fontSize: typography.dataLabel };
  // 겹치는 데이터 라벨 자동 숨김(규칙 3, 공식 labelLayout).
  const labelLayout = o.dataLabel === true ? { hideOverlap: true } : undefined;
  const horizontal = variant === 'horizontal';

  // ── 상자수염 — 카테고리별 5수 요약(min·Q1·median·Q3·max), 선형보간(R-7) ──
  if (chartType === 'boxplot') {
    const groups = new Map<string, number[]>();
    for (const r of result.rows) {
      const cat = String(r[0] ?? '');
      const v = Number(r[1]);
      if (!Number.isFinite(v)) continue;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(v);
    }
    const cats = [...groups.keys()];
    opt.tooltip = { trigger: 'item', confine: true, textStyle: { fontSize: typography.tooltip } };
    opt.xAxis = { type: 'category', data: cats, name: o.xAxis?.title, boundaryGap: true, splitArea: { show: false }, axisLabel: { rotate: o.xAxis?.rotate ?? 0, fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    opt.yAxis = { type: o.yAxis?.scale === 'log' ? 'log' : 'value', name: o.yAxis?.title, splitLine: { show: o.yAxis?.splitLine !== false }, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    opt.grid = { ...gridMargins(o, true), containLabel: o.grid?.containLabel !== false };
    opt.series = [{
      type: 'boxplot',
      name: seriesCols[0]?.name ?? '분포',
      data: cats.map((c) => fiveNumberSummary(groups.get(c)!)),
      itemStyle: { color: paletteColor(palette, 0), borderColor: paletteColor(palette, 0) },
    }];
    return opt;
  }

  // ── 히트맵 — X·Y 카테고리 매트릭스, 값=색(visualMap) ──
  if (chartType === 'heatmap') {
    const cats = result.rows.map((r) => String(r[0] ?? ''));
    const yNames = seriesCols.map((c) => c.name);
    const data: [number, number, number][] = [];
    let min = Infinity;
    let max = -Infinity;
    result.rows.forEach((r, xi) => {
      seriesCols.forEach((_c, s) => {
        const v = Number(r[1 + s]) || 0;
        data.push([xi, s, v]);
        if (v < min) min = v;
        if (v > max) max = v;
      });
    });
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (min === max) max = min + 1;
    opt.tooltip = { trigger: 'item', confine: true, textStyle: { fontSize: typography.tooltip } };
    opt.legend = { show: false };
    opt.xAxis = { type: 'category', data: cats, name: o.xAxis?.title, splitArea: { show: true }, axisLabel: { rotate: o.xAxis?.rotate ?? 0, fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    opt.yAxis = { type: 'category', data: yNames, name: o.yAxis?.title, splitArea: { show: true }, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    const hm = gridMargins(o, false); // heatmap 은 범례 제거 → 제목만 가산
    opt.grid = { ...hm, bottom: hm.bottom + metrics.visualMapHeight, containLabel: o.grid?.containLabel !== false };
    opt.visualMap = visualMapConfig(min, max, palette, titleAtBottom(o) ? metrics.titleHeight : 0, typography.legend);
    opt.series = [{ type: 'heatmap', name: '값', data, label: { show: o.dataLabel === true, fontSize: typography.dataLabel } }];
    return opt;
  }

  // ── 지도 — 지역별 값=색(visualMap). map.name 으로 시도/시군구 선택 ──
  if (chartType === 'map') {
    const spatial = result.columns.some((column) => column.name === '__chartsdk_geojson');
    const data = result.rows.map((r) => ({ name: String(r[0] ?? ''), value: Number(r[1]) || 0 }));
    const vals = data.map((d) => d.value);
    let min = vals.length ? Math.min(...vals) : 0;
    let max = vals.length ? Math.max(...vals) : 1;
    if (min === max) max = min + 1;
    opt.tooltip = { trigger: 'item', confine: true, textStyle: { fontSize: typography.tooltip } };
    opt.legend = { show: false };
    opt.visualMap = visualMapConfig(min, max, palette, titleAtBottom(o) ? metrics.titleHeight : 0, typography.legend);
    let mapName = o.map?.name === 'kr-sigungu' ? 'kr-sigungu' : 'kr-sido';
    if (spatial) {
      const features = result.rows.flatMap((row) => {
        try {
          const geometry = JSON.parse(String(row[2] ?? '')) as Record<string, unknown>;
          if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return [];
          return [{ type: 'Feature', properties: { name: String(row[0] ?? '') }, geometry }];
        } catch {
          return [];
        }
      });
      const fingerprint = JSON.stringify(features);
      let hash = 2166136261;
      for (let i = 0; i < fingerprint.length; i++) hash = Math.imul(hash ^ fingerprint.charCodeAt(i), 16777619);
      mapName = `chartsdk-dynamic-mock-${(hash >>> 0).toString(16)}`;
      opt[EMBEDDED_MAPS_KEY] = [{ name: mapName, geoJSON: { type: 'FeatureCollection', features } }];
    }
    opt.series = [{
      type: 'map',
      map: mapName,
      roam: o.map?.roam === true,
      label: { show: o.dataLabel === true, fontSize: typography.dataLabel },
      ...(o.dataLabel === true ? { labelLayout: { hideOverlap: true } } : {}),
      emphasis: { label: { show: true } },
      data,
    }];
    opt[MAP_VIEWPORT_KEY] = o.map?.viewport ?? { mode: 'data' };
    return opt;
  }

  // ── 지도 포인트 — geo 좌표계 + scatter([lng,lat(,크기값)]) (ECharts 공식 effectScatter-map 예제 구조) ──
  if (chartType === 'geoscatter') {
    const hasSize = seriesCols.length >= 2;
    const sizes = hasSize ? result.rows.map((r) => Number(r[2]) || 0) : [];
    const sMin = sizes.length ? Math.min(...sizes) : 0;
    const sMax = sizes.length ? Math.max(...sizes) : 1;
    const base = typeof o.geoscatter?.symbolSize === 'number' ? o.geoscatter.symbolSize : 10;
    // JSON 전송이라 symbolSize 콜백 불가 → 포인트별 symbolSize 를 데이터 항목에 계산해 넣는다(6~28px sqrt 스케일).
    const sizeOf = (v: number) => (sMax === sMin ? base : Math.round(6 + 22 * Math.sqrt((v - sMin) / (sMax - sMin))));
    opt.tooltip = { trigger: 'item', confine: true, textStyle: { fontSize: typography.tooltip } };
    opt.legend = { show: false };
    opt.geo = {
      map: o.map?.name === 'kr-sigungu' ? 'kr-sigungu' : 'kr-sido',
      roam: o.map?.roam === true,
      label: { show: false },
      itemStyle: { areaColor: '#f3f4f6', borderColor: '#d1d5db' },
      emphasis: { itemStyle: { areaColor: '#e5e7eb' }, label: { show: false } },
    };
    opt.series = [{
      type: 'scatter',
      coordinateSystem: 'geo',
      name: seriesCols[0]?.name ?? '포인트',
      symbolSize: base,
      itemStyle: { color: paletteColor(palette, 0) },
      data: result.rows.map((r) => {
        const lng = Number(r[0]) || 0;
        const lat = Number(r[1]) || 0;
        if (!hasSize) return [lng, lat];
        const v = Number(r[2]) || 0;
        return { value: [lng, lat, v], symbolSize: sizeOf(v) };
      }),
    }];
    opt[MAP_VIEWPORT_KEY] = o.map?.viewport ?? { mode: 'data' };
    return opt;
  }

  if (chartType === 'pie') {
    const radius = variant === 'donut' ? [`${100 - (o.pie?.donutWidth ?? 40)}%`, '100%'] : '70%';
    opt.series = [
      {
        type: 'pie',
        radius,
        roseType: variant === 'rose' ? 'radius' : undefined,
        label: { show: o.dataLabel === true, position: o.pie?.labelPosition ?? 'outside', fontSize: typography.dataLabel },
        data: cats.map((name, i) => ({ name, value: result.rows[i][1], itemStyle: { color: paletteColor(palette, i) } })),
      },
    ];
    return opt;
  }

  if (chartType === 'scatter') {
    opt.xAxis = { type: o.xAxis?.scale === 'log' ? 'log' : 'value', name: o.xAxis?.title, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    opt.yAxis = { type: 'value', name: o.yAxis?.title, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
    opt.grid = { ...gridMargins(o, true), containLabel: o.grid?.containLabel !== false };
    opt.series = seriesCols.map((c, s) => ({
      type: 'scatter',
      name: c.name,
      symbolSize: o.scatter?.symbolSize ?? 10,
      symbol: o.scatter?.symbol ?? 'circle',
      data: result.rows.map((r) => [Number(r[0]) || 0, Number(r[1 + s]) || 0]),
      label,
      labelLayout,
      color: paletteColor(palette, s),
      itemStyle: { color: paletteColor(palette, s) },
    }));
    return opt;
  }

  // bar / line (직교)
  const catAxis = { type: 'category', data: cats, name: o.xAxis?.title, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
  const valAxis = { type: o.yAxis?.scale === 'log' ? 'log' : 'value', name: o.yAxis?.title, splitLine: { show: o.yAxis?.splitLine !== false }, axisLabel: { fontSize: typography.axis }, nameTextStyle: { fontSize: typography.axis } };
  opt.xAxis = horizontal ? valAxis : catAxis;
  opt.yAxis = horizontal ? catAxis : valAxis;
  opt.grid = { ...gridMargins(o, true), containLabel: o.grid?.containLabel !== false };

  const stack = variant === 'stacked' || variant === 'stackedArea' ? 'total' : undefined;
  // 100% 정규화(누적 막대) — 카테고리(행)별 합으로 나눠 각 카테고리 스택이 1이 되게 (서버 변환기와 동일).
  const normalize = chartType === 'bar' && variant === 'stacked' && !!o.bar?.normalize;
  const rowTotals = normalize
    ? result.rows.map((r) => seriesCols.reduce((sum, _c, si) => sum + (Number(r[1 + si]) || 0), 0))
    : null;
  // 혼합(combo): 시리즈별 type 오버라이드 (서버 변환기와 동일).
  const seriesTypeMap: Record<string, any> = o.seriesTypes && typeof o.seriesTypes === 'object' ? o.seriesTypes : {};
  opt.series = seriesCols.map((c, s) => {
    const seriesType = seriesTypeMap[c.name] === 'bar' || seriesTypeMap[c.name] === 'line' ? seriesTypeMap[c.name] : chartType;
    const base: Record<string, any> = {
      type: seriesType,
      name: c.name,
      data: result.rows.map((r, ri) => {
        const v = Number(r[1 + s]) || 0;
        return rowTotals && rowTotals[ri] ? v / rowTotals[ri] : v;
      }),
      label,
      labelLayout,
      stack,
      color: paletteColor(palette, s),
      itemStyle: { color: paletteColor(palette, s) },
    };
    if (seriesType === 'bar') {
      if (o.bar?.borderRadius) base.itemStyle = { ...base.itemStyle, borderRadius: o.bar.borderRadius };
      if (o.bar?.showBackground) base.showBackground = true;
    }
    if (seriesType === 'line') {
      base.smooth = variant === 'smooth';
      base.step = variant === 'step' ? 'end' : undefined;
      if (variant === 'area' || variant === 'stackedArea') base.areaStyle = { opacity: o.line?.areaOpacity ?? 0.3 };
      base.lineStyle = { width: o.line?.width ?? 2, type: o.line?.lineType ?? 'solid', color: paletteColor(palette, s) };
      base.showSymbol = o.line?.showSymbol !== false;
    }
    return base;
  });
  return opt;
}

function orderedPalette(palette: string[], activeIndex: unknown): string[] {
  if (palette.length === 0) return DEFAULT_PALETTE;
  const start = typeof activeIndex === 'number' && Number.isFinite(activeIndex) ? Math.max(0, Math.round(activeIndex)) % palette.length : 0;
  if (start <= 0) return palette;
  return [...palette.slice(start), ...palette.slice(0, start)];
}

function paletteColor(palette: string[], index: number): string {
  return palette[index % palette.length] ?? DEFAULT_PALETTE[0];
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

/** 상자수염 5수 요약 [min, Q1, median, Q3, max]. */
function fiveNumberSummary(values: number[]): [number, number, number, number, number] {
  const s = [...values].sort((a, b) => a - b);
  return [s[0] ?? 0, quantileSorted(s, 0.25), quantileSorted(s, 0.5), quantileSorted(s, 0.75), s[s.length - 1] ?? 0];
}

/** heatmap·map 공용 visualMap — 팔레트[0]을 상단(고강도) 색으로, 밝은 중립을 하단으로. */
function visualMapConfig(min: number, max: number, palette: string[], bottom = 0, fontSize = 12): Record<string, unknown> {
  return {
    min,
    max,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom, // 제목이 하단이면 그 위로 올려 겹침 방지(규칙 1)
    textStyle: { fontSize },
    inRange: { color: ['#f7f7f7', paletteColor(palette, 0)] },
  };
}
