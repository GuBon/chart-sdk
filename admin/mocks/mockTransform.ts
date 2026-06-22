// ⚠ MSW 목 전용 — 프로덕션 변환기는 서버 단일(Java). 여기 로직은 server 구현 전까지
// 미리보기를 채우기 위한 스탠드인이며, 변환기 매핑 스펙(변환기_매핑스펙_차트옵션.md)의 MVP 부분만 모사한다.
// (프론트 코드가 아니라 가짜 백엔드 자리이므로 "이중 변환기 금지" 원칙과 충돌하지 않는다.)
import type { BuilderConfig, ChartType, QueryResult, SchemaTable } from '@/lib/api';

type Cols = { name: string; type: string }[];
type Rows = unknown[][];

const SAMPLE_CATS = ['의류', '식품', '가전', '도서', '생활'];
const SAMPLE_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

// 별칭 자동 생성 (생성규칙 2장)
const aliasOf = (y: { column: string; agg: string; alias?: string }) => y.alias || `${y.agg}_${y.column}`;

/** 생성된 SQL 문자열(표시용) — 생성규칙 6·7장 모사 */
export function buildGeneratedSql(cfg: BuilderConfig): string {
  if (!cfg.table || !cfg.xAxis || cfg.yAxis.length === 0) return '';
  const q = (s: string) => `"${s}"`;
  const xCol = cfg.xAxisBucket ? `DATE_TRUNC('${cfg.xAxisBucket}', ${q(cfg.xAxis)}) AS ${q(cfg.xAxis)}` : q(cfg.xAxis);
  const aggSql: Record<string, (c: string) => string> = {
    sum: (c) => `SUM(${q(c)})`,
    avg: (c) => `AVG(${q(c)})`,
    count: (c) => `COUNT(${q(c)})`,
    count_distinct: (c) => `COUNT(DISTINCT ${q(c)})`,
    min: (c) => `MIN(${q(c)})`,
    max: (c) => `MAX(${q(c)})`,
  };
  const selects = [xCol, ...cfg.yAxis.map((y) => `${aggSql[y.agg](y.column)} AS ${q(aliasOf(y))}`)];
  const where = cfg.where.length
    ? ` WHERE ${cfg.where
        .map((w) => (w.op === 'is_null' ? `${q(w.column)} IS NULL` : w.op === 'is_not_null' ? `${q(w.column)} IS NOT NULL` : `${q(w.column)} ${'='} ?`))
        .join(' AND ')}`
    : '';
  const group = cfg.xAxisBucket ? '1' : q(cfg.xAxis);
  let order = '';
  if (cfg.orderBy) {
    const pos = cfg.orderBy.target === 'x' ? 1 : Number(cfg.orderBy.target.slice(1)) + 2; // y0 → 2번째 컬럼
    order = ` ORDER BY ${pos} ${cfg.orderBy.direction.toUpperCase()}`;
  }
  return `SELECT ${selects.join(', ')}\nFROM ${q(cfg.table)}${where}\nGROUP BY ${group}${order}\nLIMIT 1000`;
}

/** 집계 결과 rows 생성 — 카테고리/월 라벨 + yAxis별 가짜 값 */
export function buildAggregateRows(cfg: BuilderConfig): QueryResult {
  const labels = cfg.xAxisBucket ? SAMPLE_MONTHS : SAMPLE_CATS;
  const columns: Cols = [{ name: cfg.xAxis ?? 'x', type: 'text' }, ...cfg.yAxis.map((y) => ({ name: aliasOf(y), type: 'numeric' }))];
  const rows: Rows = labels.map((label, i) => [
    label,
    ...cfg.yAxis.map((_, j) => Math.round(500 - i * 70 + j * 130 + (i % 2) * 40)),
  ]);
  return { columns, rows, rowCount: rows.length, truncated: false, elapsedMs: 40 + rows.length };
}

/** 원본 데이터(mode:rows) — 집계 이전 세부 행 */
export function buildRawRows(cfg: BuilderConfig): QueryResult {
  const columns: Cols = [
    { name: cfg.xAxis ?? 'category', type: 'text' },
    ...cfg.yAxis.map((y) => ({ name: y.column, type: 'numeric' })),
  ];
  const rows: Rows = Array.from({ length: 12 }, (_, i) => [
    SAMPLE_CATS[i % SAMPLE_CATS.length],
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
  const palette: string[] = o.palette ?? DEFAULT_PALETTE;
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
        data: cats.map((name, i) => ({ name, value: result.rows[i][1] })),
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
      data: result.rows.map((r) => [Number(r[1]) || 0, Number(r[1 + s]) || 0]),
      label,
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
    };
    if (chartType === 'bar') {
      if (o.bar?.borderRadius) base.itemStyle = { borderRadius: o.bar.borderRadius };
      if (o.bar?.showBackground) base.showBackground = true;
    }
    if (chartType === 'line') {
      base.smooth = variant === 'smooth';
      base.step = variant === 'step' ? 'end' : undefined;
      if (variant === 'area' || variant === 'stackedArea') base.areaStyle = { opacity: o.line?.areaOpacity ?? 0.3 };
      base.lineStyle = { width: o.line?.width ?? 2, type: o.line?.lineType ?? 'solid' };
      base.showSymbol = o.line?.showSymbol !== false;
    }
    return base;
  });
  return opt;
}
