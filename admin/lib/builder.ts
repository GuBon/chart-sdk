import type { AggType, BuilderConfig, ChartType, JoinSpec, JoinType, SchemaTable, TableRef, WhereOp, XAxisBucket } from '@/lib/api';

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

// ── 테이블 식별자(소스·스키마 한정 TableRef) ──────────────────────────────
/** TableRef 안정 키 — 비교·중복제거·SchemaTable 매칭용. SchemaTable 도 같은 필드 구성이라 그대로 쓴다. */
export function tableRefKey(t: { datasourceId: number; schema: string; name: string }): string {
  return `${t.datasourceId}.${t.schema}.${t.name}`;
}

/** 표시 라벨 — public 은 스키마 생략(schema.table 또는 table). 소스는 셀렉트 옆에 별도 표기. */
export function tableRefLabel(t: TableRef | SchemaTable): string {
  return t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
}

/** 컬럼 참조 prefix 로 쓰는 테이블 핸들 — 기본은 이름, 동명 충돌 시 저장된 handle(users_2). 백엔드 parseTableRef 와 규약 일치. */
export function tableHandle(ref: TableRef): string {
  return ref.handle ?? ref.name;
}

/** others(다른 활성 테이블)와 겹치지 않는 유일 핸들을 부여. 안 겹치면 이름 그대로(handle 미설정) — 비충돌 차트는 기존과 동일. */
export function withUniqueHandle(ref: TableRef, others: TableRef[]): TableRef {
  const taken = new Set(others.map(tableHandle));
  if (!taken.has(ref.name)) return { ...ref, handle: undefined };
  let n = 2;
  while (taken.has(`${ref.name}_${n}`)) n += 1;
  return { ...ref, handle: `${ref.name}_${n}` };
}

/** base + 조인 테이블(TableRef, 등장 순서·중복 제거). */
export function activeTables(cfg: BuilderConfig): TableRef[] {
  const ts: TableRef[] = cfg.table ? [cfg.table] : [];
  (cfg.joins ?? []).forEach((j) => {
    if (j.table && !ts.some((t) => tableRefKey(t) === tableRefKey(j.table))) ts.push(j.table);
  });
  return ts;
}

/** SchemaTable 풀에서 TableRef 에 해당하는 테이블(소스·스키마·이름 일치). */
function schemaTableOf(tables: SchemaTable[], ref: TableRef | null | undefined): SchemaTable | undefined {
  if (!ref) return undefined;
  return tables.find((t) => tableRefKey(t) === tableRefKey(ref));
}

const columnsOf = (tables: SchemaTable[], ref: TableRef | null | undefined) => schemaTableOf(tables, ref)?.columns ?? [];

/** 컬럼 참조("handle.col" 또는 base 암묵 "col")가 속한 활성 TableRef. 조인 시 테이블 핸들로 매칭(§11.2, 동명 테이블 구분). */
function refTable(cfg: BuilderConfig, colRef: string): TableRef | undefined {
  const i = colRef.indexOf('.');
  if (i < 0) return cfg.table ?? undefined; // 미조인/base 암묵
  const handle = colRef.slice(0, i);
  return activeTables(cfg).find((t) => tableHandle(t) === handle);
}

const colName = (ref: string): string => {
  const i = ref.indexOf('.');
  return i < 0 ? ref : ref.slice(i + 1);
};

/** "table.col" → {table(bare), column}. '.' 없으면 base 테이블 이름 암묵(하위호환, 11.2) */
export function parseColumn(ref: string, baseTableName: string | null): { table: string | null; column: string } {
  const i = ref.indexOf('.');
  return i < 0 ? { table: baseTableName, column: ref } : { table: ref.slice(0, i), column: ref.slice(i + 1) };
}

/** 빌더 컬럼 셀렉트 옵션 — 조인 시 활성 테이블 전부 "핸들.컬럼", 미조인 시 base "컬럼" (11.2, 백엔드는 핸들을 소스로 해석) */
export function columnsForBuilder(cfg: BuilderConfig, tables: SchemaTable[]): { value: string; label: string; type: string }[] {
  if (!hasJoins(cfg)) return columnsOf(tables, cfg.table).map((c) => ({ value: c.name, label: c.name, type: c.type }));
  return activeTables(cfg).flatMap((ref) =>
    columnsOf(tables, ref).map((c) => ({ value: `${tableHandle(ref)}.${c.name}`, label: `${tableHandle(ref)}.${c.name}`, type: c.type })),
  );
}

/** 컬럼 참조의 타입 해석 (조인 qualified·단일 모두) */
export function columnType(ref: string | null | undefined, cfg: BuilderConfig, tables: SchemaTable[]): string | undefined {
  if (!ref) return undefined;
  return columnsOf(tables, refTable(cfg, ref)).find((c) => c.name === colName(ref))?.type;
}

const typeGroup = (type: string | undefined): 'num' | 'date' | 'text' =>
  isNumericType(type) ? 'num' : isDateType(type) ? 'date' : 'text';

export function emptyJoin(table: TableRef): JoinSpec {
  return { table, type: 'left', on: { leftColumn: '', rightColumn: '' } };
}

/** 조인 검증 (생성규칙 11.4) — 실행 차단 사유 1건 반환, 없으면 null */
function joinValidationIssue(cfg: BuilderConfig, tables: SchemaTable[]): string | null {
  const joins = cfg.joins ?? [];
  if (joins.length === 0) return null;
  // 컬럼 참조는 테이블 핸들을 쓰므로 체인 추적도 핸들로 한다(§11.2). 동명 테이블은 핸들이 달라 함께 조인 가능.
  const seen = cfg.table ? [tableHandle(cfg.table)] : [];
  for (const j of joins) {
    if (!j.table) return '조인할 테이블을 선택하세요.';
    const jHandle = tableHandle(j.table);
    if (seen.includes(jHandle)) return `같은 테이블을 중복 조인할 수 없습니다: ${tableRefLabel(j.table)}`;
    if (!schemaTableOf(tables, j.table)) return `존재하지 않는 테이블: ${tableRefLabel(j.table)}`;
    if (!j.on.leftColumn || !j.on.rightColumn) return '조인 조건(ON)의 양쪽 컬럼을 선택하세요.';
    const L = parseColumn(j.on.leftColumn, cfg.table ? tableHandle(cfg.table) : null);
    const R = parseColumn(j.on.rightColumn, cfg.table ? tableHandle(cfg.table) : null);
    if (!seen.includes(L.table ?? '')) return `조인 기준(ON 왼쪽)은 앞선 테이블의 컬럼이어야 합니다: ${j.on.leftColumn}`;
    if (R.table !== jHandle) return `조인 대상(ON 오른쪽)은 ${tableRefLabel(j.table)} 의 컬럼이어야 합니다.`;
    const lt = columnsOf(tables, refTable(cfg, j.on.leftColumn)).find((c) => c.name === L.column)?.type;
    const rt = columnsOf(tables, refTable(cfg, j.on.rightColumn)).find((c) => c.name === R.column)?.type;
    if (!lt) return `존재하지 않는 컬럼: ${j.on.leftColumn}`;
    if (!rt) return `존재하지 않는 컬럼: ${j.on.rightColumn}`;
    if (typeGroup(lt) !== typeGroup(rt)) return `조인 키 타입이 호환되지 않습니다: ${j.on.leftColumn} ↔ ${j.on.rightColumn}`;
    seen.push(jHandle);
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
  // 조인 시 모든 컬럼 참조는 qualified "핸들.컬럼" + 활성 테이블 (11.2)
  if (hasJoins(cfg)) {
    const activeHandles = activeTables(cfg).map(tableHandle);
    const refs = [cfg.xAxis, ...cfg.yAxis.map((y) => y.column), ...cfg.where.map((w) => w.column)].filter(Boolean) as string[];
    for (const r of refs) {
      if (r.indexOf('.') < 0) return '조인 시 컬럼은 "테이블.컬럼" 형식이어야 합니다.';
      if (!activeHandles.includes(parseColumn(r, tableHandle(cfg.table)).table ?? '')) return `조인에 없는 테이블 참조: ${r}`;
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
  // 다중 소스 안내(설계 §7) — 저장 시 스냅샷으로 고정, 소스 변경은 새로고침으로 반영. 가장 근본적 동작이라 먼저.
  const sources = new Set(activeTables(cfg).map((t) => t.datasourceId));
  if (sources.size >= 2) return '여러 데이터소스를 조인하면 저장 시점 스냅샷으로 고정됩니다(새로고침으로 갱신).';
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

/** 레거시 문자열 테이블 참조("schema.table"/"table") → TableRef 승격. 저장된 단일 소스 차트 로드 시(하위호환). */
export function migrateTableRef(raw: unknown, primaryDatasourceId: number): TableRef | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as TableRef; // 이미 구조화됨
  const s = String(raw);
  const i = s.indexOf('.');
  return i < 0
    ? { datasourceId: primaryDatasourceId, schema: 'public', name: s }
    : { datasourceId: primaryDatasourceId, schema: s.slice(0, i), name: s.slice(i + 1) };
}

/** builderConfig 의 base·조인 테이블 참조를 TableRef 로 승격(레거시 차트 로드용). 저장된 handle 은 보존, 없는 것만 유일 핸들 부여. */
export function migrateBuilderConfig(cfg: BuilderConfig, primaryDatasourceId: number): BuilderConfig {
  const base = migrateTableRef(cfg.table, primaryDatasourceId);
  const assigned: TableRef[] = base ? [base] : [];
  const joins = (cfg.joins ?? []).map((j) => {
    const t = migrateTableRef(j.table, primaryDatasourceId) as TableRef;
    const withHandle = t.handle ? t : withUniqueHandle(t, assigned);
    assigned.push(withHandle);
    return { ...j, table: withHandle };
  });
  return { ...cfg, table: base, joins };
}

/** orderBy 대상 라벨 (x = X축, y{i} = i번째 시리즈 별칭) */
export function orderTargets(cfg: BuilderConfig): { value: string; label: string }[] {
  const targets = [{ value: 'x', label: cfg.xAxis ? `${cfg.xAxis} (X)` : 'X축' }];
  cfg.yAxis.forEach((y, i) => {
    targets.push({ value: `y${i}`, label: `${y.alias || (y.agg === 'none' ? y.column : `${y.agg}_${y.column}`)} (Y${i + 1})` });
  });
  return targets;
}
