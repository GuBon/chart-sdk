// ⚠ MSW 목 전용 — 프로덕션 변환기는 서버 단일(Java). 여기 로직은 server 구현 전까지
// 미리보기를 채우기 위한 스탠드인이며, 변환기 매핑 스펙(변환기_매핑스펙_차트옵션.md)의 MVP 부분만 모사한다.
// (프론트 코드가 아니라 가짜 백엔드 자리이므로 "이중 변환기 금지" 원칙과 충돌하지 않는다.)
import type { BuilderConfig, ChartType, QueryResult, SchemaTable } from '@/lib/api';
import {
  DEFAULT_SAMPLE_SEED,
  SAMPLING_CONTRACT_VERSION,
  normalizeSampleRate,
  samplingTreatment,
  samplingWarningForAggregate,
  type SamplingMetadata,
  type SamplingWarningCode,
} from '@chartsdk/chart-options/sampling';
import { schemaTables } from './seed';

type Cols = { name: string; type: string }[];
type Rows = unknown[][];

const SAMPLE_CATS = ['의류', '식품', '가전', '도서', '생활'];
const SAMPLE_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

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

function assertSampleAllowed(cfg: BuilderConfig) {
  if (cfg.sample && (cfg.joins?.length ?? 0) > 0) throw new Error('JOIN_SAMPLE_NOT_ALLOWED');
}

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
export function buildGeneratedSql(cfg: BuilderConfig): string {
  assertSampleAllowed(cfg);
  if (!cfg.table || !cfg.xAxis || cfg.yAxis.length === 0) return '';
  // 다중 소스면 페더레이션 → ds 별칭 표기(백엔드 §6 모사).
  const multi = new Set([cfg.table.datasourceId, ...(cfg.joins ?? []).map((j) => j.table.datasourceId)]).size >= 2;
  const where = cfg.where.length ? ` WHERE ${cfg.where.map((w) => whereSql(w)).join(' AND ')}` : '';
  // 조인(11.3) — FROM base 뒤에 joins 순서대로 [INNER|LEFT] JOIN ... ON ...
  const joinSql = (cfg.joins ?? [])
    .map((j) => ` ${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${qtable(j.table, multi)} ON ${qcol(j.on.leftColumn)} = ${qcol(j.on.rightColumn)}`)
    .join('');
  const orderSql = () => {
    if (!cfg.orderBy) return '';
    const pos = cfg.orderBy.target === 'x' ? 1 : Number(cfg.orderBy.target.slice(1)) + 2; // y0 → 2번째 컬럼
    return ` ORDER BY ${pos} ${cfg.orderBy.direction.toUpperCase()}`;
  };
  const rawMode = cfg.yAxis.some((y) => y.agg === 'none');
  if (rawMode) {
    const selects = [
      qcol(cfg.xAxis),
      ...cfg.yAxis.map((y) => (aliasOf(y) === colName(y.column) ? qcol(y.column) : `${qcol(y.column)} AS ${qident(aliasOf(y))}`)),
    ];
    return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${joinSql}${where}${orderSql()}\nLIMIT 1000`;
  }
  const xCol = cfg.xAxisBucket ? `DATE_TRUNC('${cfg.xAxisBucket}', ${qcol(cfg.xAxis)}) AS ${qident(colName(cfg.xAxis))}` : qcol(cfg.xAxis);
  const aggSql: Record<string, (c: string) => string> = {
    sum: (c) => `SUM(${qcol(c)})`,
    avg: (c) => `AVG(${qcol(c)})`,
    stddev: (c) => `STDDEV(${qcol(c)})`,
    variance: (c) => `VARIANCE(${qcol(c)})`,
    count: (c) => `COUNT(${qcol(c)})`,
    count_distinct: (c) => `COUNT(DISTINCT ${qcol(c)})`,
    min: (c) => `MIN(${qcol(c)})`,
    max: (c) => `MAX(${qcol(c)})`,
  };
  const sampleRate = cfg.sample ? clampRate(cfg.sample.rate ?? 100) : null; // 목 표시용 — count 기반은 CTE 미모사(rate 없음→평이)
  const approximate = sampleRate !== null && sampleRate < 100;
  const selects = [
    xCol,
    ...cfg.yAxis.map((y) => `${aggSql[y.agg](y.column)} AS ${qident(aliasOf(y))}`),
    ...(approximate
      ? [
          `COUNT(*) AS ${qident('__chartsdk_sample_count')}`,
          `SUM(COUNT(*)) OVER () AS ${qident('__chartsdk_sample_total')}`,
        ]
      : []),
  ];
  const group = cfg.xAxisBucket ? '1' : qcol(cfg.xAxis);
  // 표본 추출(3C) — base 뒤 TABLESAMPLE SYSTEM. 조인과 동시 사용은 검증 단계에서 차단한다.
  const seed = Math.trunc(cfg.sample?.seed ?? DEFAULT_SAMPLE_SEED);
  const sample = approximate ? ` TABLESAMPLE SYSTEM (${sampleRate}) REPEATABLE (${seed})` : '';
  return `SELECT ${selects.join(', ')}\nFROM ${qtable(cfg.table, multi)}${sample}${joinSql}${where}\nGROUP BY ${group}${orderSql()}\nLIMIT 1000`;
}

/** 표본 비율 0.1~100, 소수점 한 자리 정규화 (생성규칙 3C·9장) */
export const clampRate = normalizeSampleRate;

function populationEstimateForConfig(cfg: BuilderConfig): number {
  if (!cfg.table) return 0;
  return schemaTables.find((table) =>
    table.datasourceId === cfg.table!.datasourceId
    && table.schema === cfg.table!.schema
    && table.name === cfg.table!.name,
  )?.estimatedRowCount ?? 0;
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

  // 레거시 100% → 전량 정확 실행
  if (legacyRate != null && legacyRate >= 100) {
    return {
      version: SAMPLING_CONTRACT_VERSION, mode, requestedMethod,
      approximate: false, method: 'FULL_SCAN', rate: 100, valueMode: 'exact',
      estimates: cfg.yAxis.map((y) => ({ series: aliasOf(y), aggregate: y.agg, treatment: 'EXACT' as const })),
    };
  }

  const populationEstimate = populationEstimateForConfig(cfg);
  const legacySystem = requestedMethod === 'system' || legacyRate != null;
  // mock에는 PK 카탈로그가 없으므로 알려진 테이블은 INDEX_RANDOM 가능으로, 행수 정보가 없으면 SYSTEM 폴백으로 모사한다.
  const systemFallback = populationEstimate <= 0;
  const method: SamplingMetadata['method'] = legacySystem || systemFallback ? 'SYSTEM' : 'INDEX_RANDOM';
  const sampleSize = cfg.sample.size
    ?? (legacyRate != null && populationEstimate > 0
      ? Math.max(1_000, Math.min(50_000, Math.round(populationEstimate * legacyRate / 100)))
      : 10_000);
  const executionRate = legacyRate != null
    ? clampRate(legacyRate)
    : normalizeSampleRate(populationEstimate > 0 ? (sampleSize / populationEstimate) * 100 : Number.NaN);
  const groups = labels.map((key, index) => ({
    key,
    sampleCount: method === 'INDEX_RANDOM'
      ? Math.floor(sampleSize / Math.max(1, labels.length)) + (index < sampleSize % Math.max(1, labels.length) ? 1 : 0)
      : Math.max(1, Math.round((5_000 + index * 350) * (executionRate / 100))),
  }));
  const estimates = cfg.yAxis.map((y) => {
    const warning = samplingWarningForAggregate(y.agg);
    const base = { series: aliasOf(y), aggregate: y.agg, treatment: samplingTreatment(y.agg, true), ...(warning ? { warning } : {}) };
    // INDEX_RANDOM 목: 실제 서버와 같은 v5 형태를 미러한다. 분산 계열은 비대칭 그룹별 구간을 포함한다.
    if (method === 'INDEX_RANDOM' && ['stddev', 'variance'].includes(y.agg)) {
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
    return method === 'INDEX_RANDOM' && y.agg === 'avg'
      ? { ...base, marginOfError: 12, relativeErrorPct: 1.2 } : base;
  });
  const warnings = new Set<SamplingWarningCode>([method === 'SYSTEM' ? 'BLOCK_SAMPLE_CLUSTERING' : 'INDEX_RANDOM_SAMPLE']);
  estimates.forEach((estimate) => { if (estimate.warning) warnings.add(estimate.warning); });
  if (method === 'INDEX_RANDOM' && cfg.yAxis.some((y) => y.agg === 'stddev' || y.agg === 'variance')) {
    warnings.add('STDDEV_CI_NORMALITY_ASSUMED');
  }
  return {
    version: SAMPLING_CONTRACT_VERSION, mode, requestedMethod,
    approximate: true, method,
    ...(legacyRate != null ? { rate: executionRate } : {}),
    seed: Math.trunc(cfg.sample.seed ?? DEFAULT_SAMPLE_SEED),
    valueMode: 'sample',
    populationEstimate, sampleSize,
    sampledRowCount: groups.reduce((sum, group) => sum + group.sampleCount, 0),
    ...(method === 'INDEX_RANDOM' ? { confidenceLevel: 0.95 } : {}),
    groups, estimates,
    warnings: [...warnings],
  };
}

// map 데모용 시·도 라벨 — kr-sido.json properties.name 과 정확히 일치해야 지도에 값이 칠해진다.
const SAMPLE_REGIONS = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '경기도', '강원도', '충청북도', '전라남도', '경상북도', '제주특별자치도'];

/** 집계 결과 rows 생성 — 카테고리/월 라벨 + yAxis별 가짜 값 */
export function buildAggregateRows(cfg: BuilderConfig, chartType?: ChartType): QueryResult {
  assertSampleAllowed(cfg);
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
  }
  // 지도 포인트: 대한민국 범위 내 경도·위도(+선택 크기값) 원본 좌표.
  if (chartType === 'geoscatter') {
    const hasSize = cfg.yAxis.length >= 2;
    const columns: Cols = [
      { name: cfg.xAxis ? colName(cfg.xAxis) : 'lng', type: 'numeric' },
      { name: cfg.yAxis[0] ? colName(cfg.yAxis[0].column) : 'lat', type: 'numeric' },
      ...(hasSize ? [{ name: colName(cfg.yAxis[1].column), type: 'numeric' }] : []),
    ];
    const rows: Rows = Array.from({ length: 12 }, (_, i) => {
      const lng = 126.2 + (i % 4) * 0.9 + (i % 3) * 0.25;
      const lat = 35.0 + Math.floor(i / 4) * 1.1 + (i % 2) * 0.4;
      return hasSize ? [lng, lat, 20 + i * 15] : [lng, lat];
    });
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
  // sampling v5: 모든 집계값은 선택된 표본에서 계산한 값을 그대로 표시한다.
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

/** 원본 데이터(mode:rows) — 집계 이전 세부 행 */
export function buildRawRows(cfg: BuilderConfig): QueryResult {
  assertSampleAllowed(cfg);
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
  const sampleFor = (type: string, i: number): unknown => {
    const t = type.toLowerCase();
    if (t.includes('int') || t.includes('numeric')) return (i + 1) * 7;
    if (t.includes('date') || t.includes('time')) return `2026-0${(i % 6) + 1}-15`;
    return ['의류', '식품', '가전', '도서', '생활'][i % 5];
  };
  const rows: Rows = Array.from({ length: 12 }, (_, i) => table.columns.map((c) => sampleFor(c.type, i)));
  return { columns: table.columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 12 };
}

const DEFAULT_PALETTE = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'];

// 레이아웃 예약 높이(px) — 서버 ChartOptionConverter 와 값 일치(제목·범례·visualMap 겹침 방지).
const TITLE_H = 26;
const LEGEND_H = 24;
const VISUALMAP_H = 36;
const titleAtBottom = (o: any): boolean => !!o.title && (o.titleV ?? 'top') === 'bottom';
const presetBase = (preset?: string) =>
  preset === 'compact' ? { left: 8, right: 8, top: 8, bottom: 8 }
    : preset === 'loose' ? { left: 48, right: 48, top: 48, bottom: 48 }
      : { left: 24, right: 24, top: 28, bottom: 24 };
/** grid top/bottom 에 제목·범례 예약 높이 가산 (서버 applyMargins 미러). */
function gridMargins(o: any, includeLegend: boolean): { left: number; right: number; top: number; bottom: number } {
  const b = presetBase(o.grid?.preset);
  if (!!o.title && (o.titleV ?? 'top') === 'top') b.top += TITLE_H;
  if (titleAtBottom(o)) b.bottom += TITLE_H;
  if (includeLegend && o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    if (pos === 'top') b.top += LEGEND_H;
    if (pos === 'bottom') b.bottom += LEGEND_H;
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

  // 배경: 서버 변환기와 동일하게 불투명 기본(흰색) — 미리보기가 임베드 결과와 일치하도록.
  const opt: Record<string, any> = { color: palette, backgroundColor: o.backgroundColor ?? '#ffffff' };

  if (o.title) opt.title = { text: o.title, left: o.titleH ?? 'center', top: o.titleV ?? 'top' };
  const itemTooltip = chartType === 'pie' || chartType === 'scatter' || chartType === 'boxplot' || chartType === 'heatmap' || chartType === 'map';
  opt.tooltip = { trigger: o.tooltip?.trigger ?? (itemTooltip ? 'item' : 'axis'), confine: true };
  if (o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    // 제목이 같은 모서리면 범례를 제목 다음 줄로(규칙 1, 서버 미러).
    const titleTop = !!o.title && (o.titleV ?? 'top') === 'top';
    const offset = pos === 'top' ? (titleTop ? TITLE_H : 0) : pos === 'bottom' ? (titleAtBottom(o) ? TITLE_H : 0) : 0;
    const horizontalLegend = pos === 'top' || pos === 'bottom';
    opt.legend = {
      show: true,
      [pos]: offset,
      orient: horizontalLegend ? 'horizontal' : 'vertical',
      ...(horizontalLegend || o.legend?.scroll === true ? { type: 'scroll' } : {}),
    };
  } else {
    opt.legend = { show: false };
  }

  const label = { show: o.dataLabel === true };
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
    opt.tooltip = { trigger: 'item', confine: true };
    opt.xAxis = { type: 'category', data: cats, name: o.xAxis?.title, boundaryGap: true, splitArea: { show: false }, axisLabel: { rotate: o.xAxis?.rotate ?? 0 } };
    opt.yAxis = { type: o.yAxis?.scale === 'log' ? 'log' : 'value', name: o.yAxis?.title, splitLine: { show: o.yAxis?.splitLine !== false } };
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
    opt.tooltip = { trigger: 'item', confine: true };
    opt.legend = { show: false };
    opt.xAxis = { type: 'category', data: cats, name: o.xAxis?.title, splitArea: { show: true }, axisLabel: { rotate: o.xAxis?.rotate ?? 0 } };
    opt.yAxis = { type: 'category', data: yNames, name: o.yAxis?.title, splitArea: { show: true } };
    const hm = gridMargins(o, false); // heatmap 은 범례 제거 → 제목만 가산
    opt.grid = { ...hm, bottom: hm.bottom + VISUALMAP_H, containLabel: o.grid?.containLabel !== false };
    opt.visualMap = visualMapConfig(min, max, palette, titleAtBottom(o) ? TITLE_H : 0);
    opt.series = [{ type: 'heatmap', name: '값', data, label: { show: o.dataLabel === true } }];
    return opt;
  }

  // ── 지도 — 지역별 값=색(visualMap). map.name 으로 시도/시군구 선택 ──
  if (chartType === 'map') {
    const data = result.rows.map((r) => ({ name: String(r[0] ?? ''), value: Number(r[1]) || 0 }));
    const vals = data.map((d) => d.value);
    let min = vals.length ? Math.min(...vals) : 0;
    let max = vals.length ? Math.max(...vals) : 1;
    if (min === max) max = min + 1;
    opt.tooltip = { trigger: 'item', confine: true };
    opt.legend = { show: false };
    opt.visualMap = visualMapConfig(min, max, palette, titleAtBottom(o) ? TITLE_H : 0);
    opt.series = [{
      type: 'map',
      map: o.map?.name === 'kr-sigungu' ? 'kr-sigungu' : 'kr-sido',
      roam: o.map?.roam === true,
      label: { show: o.dataLabel === true },
      ...(o.dataLabel === true ? { labelLayout: { hideOverlap: true } } : {}),
      emphasis: { label: { show: true } },
      data,
    }];
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
    opt.tooltip = { trigger: 'item', confine: true };
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
    return opt;
  }

  if (chartType === 'pie') {
    const radius = variant === 'donut' ? [`${100 - (o.pie?.donutWidth ?? 40)}%`, '100%'] : '70%';
    opt.series = [
      {
        type: 'pie',
        radius,
        roseType: variant === 'rose' ? 'radius' : undefined,
        label: { show: o.dataLabel === true, position: o.pie?.labelPosition ?? 'outside' },
        data: cats.map((name, i) => ({ name, value: result.rows[i][1], itemStyle: { color: paletteColor(palette, i) } })),
      },
    ];
    return opt;
  }

  if (chartType === 'scatter') {
    opt.xAxis = { type: o.xAxis?.scale === 'log' ? 'log' : 'value', name: o.xAxis?.title };
    opt.yAxis = { type: 'value', name: o.yAxis?.title };
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
  const catAxis = { type: 'category', data: cats, name: o.xAxis?.title };
  const valAxis = { type: o.yAxis?.scale === 'log' ? 'log' : 'value', name: o.yAxis?.title, splitLine: { show: o.yAxis?.splitLine !== false } };
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
function visualMapConfig(min: number, max: number, palette: string[], bottom = 0): Record<string, unknown> {
  return {
    min,
    max,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom, // 제목이 하단이면 그 위로 올려 겹침 방지(규칙 1)
    inRange: { color: ['#f7f7f7', paletteColor(palette, 0)] },
  };
}
