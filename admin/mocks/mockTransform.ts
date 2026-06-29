// ⚠ MSW 목 전용 — 프로덕션 변환기는 서버 단일(Java). 여기 로직은 server 구현 전까지
// 미리보기를 채우기 위한 스탠드인이며, 변환기 매핑 스펙(변환기_매핑스펙_차트옵션.md)의 MVP 부분만 모사한다.
// (프론트 코드가 아니라 가짜 백엔드 자리이므로 "이중 변환기 금지" 원칙과 충돌하지 않는다.)
import type { BuilderConfig, ChartType, QueryResult, SchemaTable } from '@/lib/api';

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
  const where = cfg.where.length ? ` WHERE ${cfg.where.map((w) => whereSql(w)).join(' AND ')}` : '';
  // 조인(11.3) — FROM base 뒤에 joins 순서대로 [INNER|LEFT] JOIN ... ON ...
  const joinSql = (cfg.joins ?? [])
    .map((j) => ` ${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${qident(j.table)} ON ${qcol(j.on.leftColumn)} = ${qcol(j.on.rightColumn)}`)
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
    return `SELECT ${selects.join(', ')}\nFROM ${qident(cfg.table)}${joinSql}${where}${orderSql()}\nLIMIT 1000`;
  }
  const xCol = cfg.xAxisBucket ? `DATE_TRUNC('${cfg.xAxisBucket}', ${qcol(cfg.xAxis)}) AS ${qident(colName(cfg.xAxis))}` : qcol(cfg.xAxis);
  const aggSql: Record<string, (c: string) => string> = {
    sum: (c) => `SUM(${qcol(c)})`,
    avg: (c) => `AVG(${qcol(c)})`,
    stddev: (c) => `STDDEV(${qcol(c)})`,
    count: (c) => `COUNT(${qcol(c)})`,
    count_distinct: (c) => `COUNT(DISTINCT ${qcol(c)})`,
    min: (c) => `MIN(${qcol(c)})`,
    max: (c) => `MAX(${qcol(c)})`,
  };
  const selects = [xCol, ...cfg.yAxis.map((y) => `${aggSql[y.agg](y.column)} AS ${qident(aliasOf(y))}`)];
  const group = cfg.xAxisBucket ? '1' : qcol(cfg.xAxis);
  // 표본 추출(3C) — base 뒤 TABLESAMPLE SYSTEM. 조인과 동시 사용은 검증 단계에서 차단한다.
  const sample = cfg.sample ? ` TABLESAMPLE SYSTEM (${clampRate(cfg.sample.rate)})` : '';
  return `SELECT ${selects.join(', ')}\nFROM ${qident(cfg.table)}${sample}${joinSql}${where}\nGROUP BY ${group}${orderSql()}\nLIMIT 1000`;
}

/** 표본 비율 1~100 클램프 (생성규칙 3C·9장) */
export const clampRate = (rate: number) => Math.max(1, Math.min(100, Math.round(rate)));

/** 집계 결과 rows 생성 — 카테고리/월 라벨 + yAxis별 가짜 값 */
export function buildAggregateRows(cfg: BuilderConfig): QueryResult {
  assertSampleAllowed(cfg);
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
  const rate = cfg.sample ? clampRate(cfg.sample.rate) : null;
  // 표본 추출 시 합계·개수는 비율로 외삽(÷rate%), 나머지는 표본값 자체를 근사치로 표시한다.
  const factor = (agg: string) => (rate && (agg === 'sum' || agg === 'count') ? 100 / rate : 1);
  const rows: Rows = labels.map((label, i) => [
    label,
    ...cfg.yAxis.map((y, j) => Math.round((500 - i * 70 + j * 130 + (i % 2) * 40) * factor(y.agg))),
  ]);
  return {
    columns,
    rows,
    rowCount: rows.length,
    truncated: false,
    elapsedMs: (rate ? 12 : 40) + rows.length, // 표본은 전체 스캔을 건너뛰어 더 빠름
    ...(rate ? { approximate: true, sampleRate: rate } : {}),
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

/** (rows, chartType, options) → ECharts option (방식 A 모사, MVP 옵션 범위) */
export function assembleOption(result: QueryResult, chartType: ChartType, options: Record<string, any>): Record<string, unknown> {
  const o = options ?? {};
  const cats = result.rows.map((r) => r[0]);
  const seriesCols = result.columns.slice(1);
  const palette = orderedPalette(o.palette ?? DEFAULT_PALETTE, o.paletteActiveIndex);
  const variant: string = o.variant ?? (chartType === 'pie' ? 'pie' : chartType === 'scatter' ? 'scatter' : chartType === 'line' ? 'basic' : 'basic');

  const opt: Record<string, any> = { color: palette };

  if (o.title) opt.title = { text: o.title, left: o.titleH ?? 'center', top: o.titleV ?? 'top' };
  opt.tooltip = { trigger: o.tooltip?.trigger ?? (chartType === 'pie' || chartType === 'scatter' ? 'item' : 'axis') };
  if (o.legend?.show !== false) {
    const pos = o.legend?.position ?? 'bottom';
    opt.legend = { show: true, [pos]: 0, orient: pos === 'left' || pos === 'right' ? 'vertical' : 'horizontal' };
  } else {
    opt.legend = { show: false };
  }

  const label = { show: o.dataLabel === true };
  const horizontal = variant === 'horizontal';

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
    opt.series = seriesCols.map((c, s) => ({
      type: 'scatter',
      name: c.name,
      symbolSize: o.scatter?.symbolSize ?? 10,
      symbol: o.scatter?.symbol ?? 'circle',
      data: result.rows.map((r) => [Number(r[0]) || 0, Number(r[1 + s]) || 0]),
      label,
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
  opt.grid = { containLabel: o.grid?.containLabel !== false };

  const stack = variant === 'stacked' || variant === 'stackedArea' ? 'total' : undefined;
  opt.series = seriesCols.map((c, s) => {
    const base: Record<string, any> = {
      type: chartType,
      name: c.name,
      data: result.rows.map((r) => Number(r[1 + s]) || 0),
      label,
      stack,
      color: paletteColor(palette, s),
      itemStyle: { color: paletteColor(palette, s) },
    };
    if (chartType === 'bar') {
      if (o.bar?.borderRadius) base.itemStyle = { ...base.itemStyle, borderRadius: o.bar.borderRadius };
      if (o.bar?.showBackground) base.showBackground = true;
    }
    if (chartType === 'line') {
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
