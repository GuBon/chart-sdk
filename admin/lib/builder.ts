import type { AggType, BuilderConfig, ChartType, JoinSpec, JoinType, SchemaTable, WhereOp, XAxisBucket } from '@/lib/api';

// 노코드 빌더 UI 상수 — 생성규칙 3·3A·4장의 라벨.
export const AGG_CHOICES: { value: AggType; label: string }[] = [
  { value: 'sum', label: '합계 (SUM)' },
  { value: 'avg', label: '평균 (AVG)' },
  { value: 'stddev', label: '표준편차 (STDDEV)' },
  { value: 'count', label: '개수 (COUNT)' },
  { value: 'count_distinct', label: '고유 개수' },
  { value: 'min', label: '최소 (MIN)' },
  { value: 'max', label: '최대 (MAX)' },
  { value: 'none', label: '원본값' },
];

export const OP_CHOICES: { value: WhereOp; label: string }[] = [
  { value: 'eq', label: '= 같음' },
  { value: 'neq', label: '≠ 같지 않음' },
  { value: 'gt', label: '> 초과' },
  { value: 'gte', label: '≥ 이상' },
  { value: 'lt', label: '< 미만' },
  { value: 'lte', label: '≤ 이하' },
  { value: 'contains', label: '포함' },
  { value: 'starts_with', label: '~로 시작' },
  { value: 'in', label: '목록 중 (,)' },
  { value: 'between', label: '사이 (a,b)' },
  { value: 'is_null', label: '비어 있음' },
  { value: 'is_not_null', label: '비어 있지 않음' },
];

export const BUCKET_CHOICES: { value: Exclude<XAxisBucket, null>; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
];

/** 값 입력이 필요 없는 연산자 (생성규칙 4장) */
export const VALUELESS_OPS: WhereOp[] = ['is_null', 'is_not_null'];

/** X축 묶기를 노출할 날짜 계열 타입 (생성규칙 3A) */
export function isDateType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('date') || t.includes('timestamp') || t.includes('time');
}

export function isNumericType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return ['int', 'numeric', 'decimal', 'double', 'real', 'float', 'serial', 'money'].some((token) => t.includes(token));
}

export function aggChoicesForChart(chartType: ChartType): { value: AggType; label: string }[] {
  if (chartType === 'scatter') return AGG_CHOICES.filter((a) => a.value === 'none');
  return AGG_CHOICES;
}

// ── 테이블 조인 (생성규칙 11장) ──────────────────────────────────
export const JOIN_TYPE_CHOICES: { value: JoinType; label: string }[] = [
  { value: 'inner', label: '교집합 (INNER)' },
  { value: 'left', label: '왼쪽 기준 (LEFT)' },
];

/** 조인 소프트 상한 (11.1) — 초과 시 UI 경고(실행 차단 아님) */
export const MAX_JOINS = 5;

export function hasJoins(cfg: BuilderConfig): boolean {
  return !!cfg.joins && cfg.joins.length > 0;
}

/** base + 조인 테이블 (체인 등장 순서, 중복 제거) */
export function activeTables(cfg: BuilderConfig): string[] {
  const ts = cfg.table ? [cfg.table] : [];
  (cfg.joins ?? []).forEach((j) => { if (j.table && !ts.includes(j.table)) ts.push(j.table); });
  return ts;
}

// ── 테이블 식별자(스키마 한정) ──────────────────────────────────
/** config.table / join.table 에 저장하는 식별자. 비-public 스키마만 "schema.table" 로 한정(백엔드 §1.2). */
export function tableKey(t: SchemaTable): string {
  return t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
}

/** 테이블 키에서 bare 이름 추출 — 조인 컬럼 참조는 bare 이름을 쓴다(백엔드 knownTables 가 bare 키). */
export function bareTableName(key: string): string {
  const i = key.indexOf('.');
  return i < 0 ? key : key.slice(i + 1);
}

/** 테이블 키를 {schema, name} 으로 분리(스키마 미지정 → public). 스키마 미리보기 요청에 쓴다. */
export function splitTableKey(key: string): { schema: string; name: string } {
  const i = key.indexOf('.');
  return i < 0 ? { schema: 'public', name: key } : { schema: key.slice(0, i), name: key.slice(i + 1) };
}

/** 테이블 키(base·셀렉터) 또는 bare 이름(조인 컬럼 참조) 어느 쪽으로도 테이블을 찾는다. */
function findTable(tables: SchemaTable[], ref: string | null): SchemaTable | undefined {
  if (!ref) return undefined;
  return tables.find((t) => tableKey(t) === ref) ?? tables.find((t) => t.name === ref);
}

/** "table.col" → {table, column}. '.' 없으면 base 테이블 암묵(하위호환, 11.2) */
export function parseColumn(ref: string, baseTable: string | null): { table: string | null; column: string } {
  const i = ref.indexOf('.');
  return i < 0 ? { table: baseTable, column: ref } : { table: ref.slice(0, i), column: ref.slice(i + 1) };
}

const columnsOf = (tables: SchemaTable[], table: string | null) => findTable(tables, table)?.columns ?? [];

/** 빌더 컬럼 셀렉트 옵션 — 조인 시 활성 테이블 전부 qualified, 미조인 시 base unqualified (11.2) */
export function columnsForBuilder(cfg: BuilderConfig, tables: SchemaTable[]): { value: string; label: string; type: string }[] {
  if (!hasJoins(cfg)) return columnsOf(tables, cfg.table).map((c) => ({ value: c.name, label: c.name, type: c.type }));
  // 조인 컬럼 참조는 bare 테이블 이름으로 qualified — 백엔드가 bare 이름을 스키마로 해석(§11.2).
  return activeTables(cfg).flatMap((t) => {
    const bare = bareTableName(t);
    return columnsOf(tables, t).map((c) => ({ value: `${bare}.${c.name}`, label: `${bare}.${c.name}`, type: c.type }));
  });
}

/** 컬럼 참조의 타입 해석 (조인 qualified·단일 모두) */
export function columnType(ref: string | null | undefined, cfg: BuilderConfig, tables: SchemaTable[]): string | undefined {
  if (!ref) return undefined;
  const { table, column } = parseColumn(ref, cfg.table);
  return columnsOf(tables, table).find((c) => c.name === column)?.type;
}

const typeGroup = (type: string | undefined): 'num' | 'date' | 'text' =>
  isNumericType(type) ? 'num' : isDateType(type) ? 'date' : 'text';

export function emptyJoin(table: string): JoinSpec {
  return { table, type: 'left', on: { leftColumn: '', rightColumn: '' } };
}

/** 조인 검증 (생성규칙 11.4) — 실행 차단 사유 1건 반환, 없으면 null */
function joinValidationIssue(cfg: BuilderConfig, tables: SchemaTable[]): string | null {
  const joins = cfg.joins ?? [];
  if (joins.length === 0) return null;
  // 컬럼 참조는 bare 테이블 이름을 쓰므로 체인 추적도 bare 이름으로 한다(§11.2).
  const seen = cfg.table ? [bareTableName(cfg.table)] : []; // 체인: 이미 등장한 테이블(bare)
  for (const j of joins) {
    if (!j.table) return '조인할 테이블을 선택하세요.';
    const jBare = bareTableName(j.table);
    if (seen.includes(jBare)) return `같은 테이블을 중복 조인할 수 없습니다: ${j.table}`;
    if (!findTable(tables, j.table)) return `존재하지 않는 테이블: ${j.table}`;
    if (!j.on.leftColumn || !j.on.rightColumn) return '조인 조건(ON)의 양쪽 컬럼을 선택하세요.';
    const L = parseColumn(j.on.leftColumn, cfg.table);
    const R = parseColumn(j.on.rightColumn, cfg.table);
    if (!seen.includes(L.table ?? '')) return `조인 기준(ON 왼쪽)은 앞선 테이블의 컬럼이어야 합니다: ${j.on.leftColumn}`;
    if (R.table !== jBare) return `조인 대상(ON 오른쪽)은 ${j.table} 의 컬럼이어야 합니다.`;
    const lt = columnsOf(tables, L.table).find((c) => c.name === L.column)?.type;
    const rt = columnsOf(tables, R.table).find((c) => c.name === R.column)?.type;
    if (!lt) return `존재하지 않는 컬럼: ${j.on.leftColumn}`;
    if (!rt) return `존재하지 않는 컬럼: ${j.on.rightColumn}`;
    if (typeGroup(lt) !== typeGroup(rt)) return `조인 키 타입이 호환되지 않습니다: ${j.on.leftColumn} ↔ ${j.on.rightColumn}`;
    seen.push(jBare);
  }
  return null;
}

export function normalizeBuilderForChartType(cfg: BuilderConfig, chartType: ChartType): BuilderConfig {
  if (chartType === 'scatter') {
    return {
      ...cfg,
      xAxisBucket: null,
      sample: null,
      yAxis: cfg.yAxis.map((y) => ({ ...y, agg: 'none' })),
    };
  }
  return {
    ...cfg,
    yAxis: chartType === 'pie' ? cfg.yAxis.slice(0, 1) : cfg.yAxis,
    sample: cfg.yAxis.some((y) => y.agg === 'none') ? null : cfg.sample,
  };
}

export function builderValidationIssue(cfg: BuilderConfig, chartType: ChartType, tables: SchemaTable[]): string | null {
  if (!cfg.table) return '테이블을 선택하세요.';
  if (cfg.sample && (cfg.sample.rate < 1 || cfg.sample.rate > 100)) return '표본 비율은 1~100%여야 합니다.';
  const joinIssue = joinValidationIssue(cfg, tables);
  if (joinIssue) return joinIssue;
  // 조인 시 모든 컬럼 참조는 qualified "테이블.컬럼" + 활성 테이블 (11.2)
  if (hasJoins(cfg)) {
    const active = activeTables(cfg).map(bareTableName); // 컬럼 참조의 테이블 접두는 bare 이름
    const refs = [cfg.xAxis, ...cfg.yAxis.map((y) => y.column), ...cfg.where.map((w) => w.column)].filter(Boolean) as string[];
    for (const r of refs) {
      if (r.indexOf('.') < 0) return '조인 시 컬럼은 "테이블.컬럼" 형식이어야 합니다.';
      if (!active.includes(parseColumn(r, cfg.table).table ?? '')) return `조인에 없는 테이블 참조: ${r}`;
    }
    if (cfg.sample) return '표본 추출은 조인과 함께 사용할 수 없습니다.';
  }
  if (!cfg.xAxis) return 'X축 컬럼을 선택하세요.';
  if (cfg.yAxis.length === 0) return 'Y축을 1개 이상 추가하세요.';
  if (cfg.yAxis.some((y) => !y.column)) return 'Y축 컬럼을 선택하세요.';
  if (chartType === 'pie' && cfg.yAxis.length !== 1) return '원형 차트는 Y축을 1개만 사용할 수 있습니다.';
  const xType = columnType(cfg.xAxis, cfg, tables);
  const rawSeriesCount = cfg.yAxis.filter((y) => y.agg === 'none').length;
  if (chartType === 'scatter' && !isNumericType(xType)) return '분포 차트는 숫자 X축 컬럼이 필요합니다.';
  if (chartType === 'scatter' && cfg.yAxis.some((y) => y.agg !== 'none')) return '분포 차트는 집계 없이 원본값만 사용할 수 있습니다.';
  if (rawSeriesCount > 0 && rawSeriesCount !== cfg.yAxis.length) {
    return '원본값은 집계값과 섞을 수 없습니다. 모든 Y축을 원본값으로 선택하세요.';
  }
  if (rawSeriesCount > 0 && cfg.sample) return '원본값 모드에서는 표본 추출을 사용할 수 없습니다.';
  return null;
}

/** 조인 개수 소프트 상한 경고 (실행은 가능, UI 안내용) — 11.1 */
export function builderWarning(cfg: BuilderConfig): string | null {
  if ((cfg.joins?.length ?? 0) > MAX_JOINS) return `조인이 ${MAX_JOINS}개를 넘으면 느려질 수 있습니다.`;
  if (hasJoins(cfg) && cfg.yAxis.some((y) => y.agg === 'sum' || y.agg === 'count')) {
    return '1:N 조인 시 합계·개수가 중복 집계될 수 있습니다 — 고유 개수(COUNT DISTINCT)를 고려하세요.';
  }
  return null;
}

/** 표본 추출 토글 시 적용할 기본 비율(%) — 생성규칙 3C */
export const DEFAULT_SAMPLE_RATE = 10;

export function emptyBuilder(): BuilderConfig {
  return { table: null, joins: [], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: null };
}

export function normalizeBuilder(cfg: BuilderConfig): BuilderConfig {
  return { ...emptyBuilder(), ...cfg, joins: cfg.joins ?? [], sample: cfg.sample ?? null };
}

/** orderBy 대상 라벨 (x = X축, y{i} = i번째 시리즈 별칭) */
export function orderTargets(cfg: BuilderConfig): { value: string; label: string }[] {
  const targets = [{ value: 'x', label: cfg.xAxis ? `${cfg.xAxis} (X)` : 'X축' }];
  cfg.yAxis.forEach((y, i) => {
    targets.push({ value: `y${i}`, label: `${y.alias || (y.agg === 'none' ? y.column : `${y.agg}_${y.column}`)} (Y${i + 1})` });
  });
  return targets;
}
