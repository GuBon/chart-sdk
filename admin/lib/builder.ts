import type { AggType, BuilderConfig, ChartType, JoinSpec, JoinType, SchemaTable, TableRef, WhereOp, XAxisBucket } from '@/lib/api';
import {
  DEFAULT_SAMPLE_SEED,
  DEFAULT_SAMPLE_SIZE,
  MAX_SAMPLE_RATE,
  MAX_SAMPLE_SIZE,
  MIN_SAMPLE_RATE,
  MIN_SAMPLE_SIZE,
  normalizeSampleRate,
  normalizeSampleSize,
  type SamplingMode,
} from '@chartsdk/chart-options/sampling';

// 노코드 빌더 UI 상수 — 생성규칙 3·3A·4장의 라벨.
export const AGG_CHOICES: { value: AggType; label: string }[] = [
  { value: 'sum', label: '합계 (SUM)' },
  { value: 'avg', label: '평균 (AVG)' },
  { value: 'stddev', label: '표준편차 (STDDEV)' },
  { value: 'variance', label: '분산 (VARIANCE)' },
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
  // 분포·상자수염·지도 포인트는 원본값(좌표/분포)이 필요 → 집계 없이 none 만.
  if (chartType === 'scatter' || chartType === 'boxplot' || chartType === 'geoscatter') return AGG_CHOICES.filter((a) => a.value === 'none');
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

/** 표시 라벨 — 스키마가 있으면 항상 schema.table 로 표시. 소스는 셀렉트 옆에 별도 표기. */
export function tableRefLabel(t: TableRef | SchemaTable): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name;
}

/** PostGIS가 타입 수정자와 함께 노출한 Point 컬럼. SRID 없는 generic geometry는 좌표계를 확정할 수 없어 제외한다. */
export function isSpatialPointType(type: string | undefined): boolean {
  if (!type) return false;
  return /\b(?:geometry|geography)\s*\(\s*point(?:zm|z|m)?\s*,\s*[1-9]\d*\s*\)/i.test(type);
}

/** SRID가 명시된 PostGIS Polygon/MultiPolygon 컬럼. */
export function isSpatialAreaType(type: string | undefined): boolean {
  if (!type) return false;
  return /\b(?:geometry|geography)\s*\(\s*(?:multi)?polygon(?:zm|z|m)?\s*,\s*[1-9]\d*\s*\)/i.test(type);
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
  const supportsSeriesBy = chartType === 'bar' || chartType === 'line';
  cfg = {
    ...cfg,
    seriesBy: supportsSeriesBy ? cfg.seriesBy ?? null : null,
    seriesOrder: supportsSeriesBy ? cfg.seriesOrder ?? 'asc' : 'asc',
    yAxis: supportsSeriesBy && cfg.seriesBy ? cfg.yAxis.slice(0, 1) : cfg.yAxis,
  };
  if (chartType === 'scatter') {
    return {
      ...cfg,
      xAxisBucket: null,
      sample: null,
      yAxis: cfg.yAxis.map((y) => ({ ...y, agg: 'none' })),
    };
  }
  // 상자수염: 카테고리별 원본값 분포 → 집계 없음·표본 금지·버킷 금지·단일 값 컬럼.
  if (chartType === 'boxplot') {
    return {
      ...cfg,
      xAxisBucket: null,
      sample: null,
      yAxis: cfg.yAxis.slice(0, 1).map((y) => ({ ...y, agg: 'none' })),
    };
  }
  // 지도 포인트: X=경도, Y1=위도(+선택 Y2=크기값) 원본 좌표 → 집계 없음·표본/버킷 금지·최대 2컬럼.
  if (chartType === 'geoscatter') {
    const mode = cfg.geoPoint?.mode ?? 'columns';
    if (mode === 'spatial') {
      return {
        ...cfg,
        xAxis: null,
        xAxisBucket: null,
        yAxis: [],
        orderBy: null,
        sample: null,
        geoPoint: {
          mode: 'spatial',
          spatialColumn: cfg.geoPoint?.spatialColumn ?? null,
          sizeColumn: cfg.geoPoint?.sizeColumn ?? null,
        },
        geoArea: undefined,
      };
    }
    return {
      ...cfg,
      xAxisBucket: null,
      sample: null,
      yAxis: cfg.yAxis.slice(0, 2).map((y) => ({ ...y, agg: 'none' })),
      geoPoint: { mode: 'columns' },
      geoArea: undefined,
    };
  }
  if (chartType === 'map') {
    const mode = cfg.geoArea?.mode ?? 'regions';
    if (mode === 'spatial') {
      return {
        ...cfg,
        xAxis: null,
        xAxisBucket: null,
        yAxis: [],
        orderBy: null,
        sample: null,
        geoPoint: undefined,
        geoArea: {
          mode: 'spatial',
          spatialColumn: cfg.geoArea?.spatialColumn ?? null,
          nameColumn: cfg.geoArea?.nameColumn ?? null,
          valueColumn: cfg.geoArea?.valueColumn ?? null,
        },
      };
    }
    return {
      ...cfg,
      yAxis: cfg.yAxis.slice(0, 1),
      sample: cfg.yAxis.some((y) => y.agg === 'none') ? null : cfg.sample,
      geoPoint: undefined,
      geoArea: { mode: 'regions' },
    };
  }
  return {
    ...cfg,
    // 원형은 조각별 단일 값 컬럼.
    seriesBy: supportsSeriesBy ? cfg.seriesBy ?? null : null,
    seriesOrder: supportsSeriesBy ? cfg.seriesOrder ?? 'asc' : 'asc',
    yAxis: chartType === 'pie' || ((chartType === 'bar' || chartType === 'line') && cfg.seriesBy) ? cfg.yAxis.slice(0, 1) : cfg.yAxis,
    sample: cfg.yAxis.some((y) => y.agg === 'none') ? null : cfg.sample,
    geoPoint: undefined,
    geoArea: undefined,
  };
}

export function builderValidationIssue(cfg: BuilderConfig, chartType: ChartType, tables: SchemaTable[]): string | null {
  if (!cfg.table) return '테이블을 선택하세요.';
  if (cfg.sample?.rate != null && (cfg.sample.rate < MIN_SAMPLE_RATE || cfg.sample.rate > MAX_SAMPLE_RATE ||
      Math.abs(cfg.sample.rate * 10 - Math.round(cfg.sample.rate * 10)) > 1e-7)) {
    return '표본 비율은 0.1~100%이며 소수점 한 자리까지 입력할 수 있습니다.';
  }
  if (cfg.sample?.size != null && (!Number.isInteger(cfg.sample.size)
      || cfg.sample.size < MIN_SAMPLE_SIZE || cfg.sample.size > MAX_SAMPLE_SIZE)) {
    return `표본 크기는 ${MIN_SAMPLE_SIZE.toLocaleString()}~${MAX_SAMPLE_SIZE.toLocaleString()}행이어야 합니다.`;
  }
  if (cfg.sample?.method != null && !['auto', 'system'].includes(cfg.sample.method)) return '표본 방식이 올바르지 않습니다.';
  if (cfg.sample?.mode != null && !['auto', 'manual'].includes(cfg.sample.mode)) return '표본 모드는 자동 또는 수동이어야 합니다.';
  if (cfg.sample?.seed != null && (!Number.isInteger(cfg.sample.seed) || cfg.sample.seed < 0 || cfg.sample.seed > 2_147_483_647)) {
    return '표본 seed가 올바르지 않습니다.';
  }
  if (cfg.yAxis.some((y) => y.alias?.startsWith('__chartsdk_'))) return '별칭은 __chartsdk_로 시작할 수 없습니다.';
  const joinIssue = joinValidationIssue(cfg, tables);
  if (joinIssue) return joinIssue;
  // 조인 시 모든 컬럼 참조는 qualified "핸들.컬럼" + 활성 테이블 (11.2)
  if (hasJoins(cfg)) {
    const activeHandles = activeTables(cfg).map(tableHandle);
    const refs = [
      cfg.xAxis,
      ...cfg.yAxis.map((y) => y.column),
      cfg.geoPoint?.spatialColumn,
      cfg.geoPoint?.sizeColumn,
      cfg.geoArea?.spatialColumn,
      cfg.geoArea?.nameColumn,
      cfg.geoArea?.valueColumn,
      ...cfg.where.map((w) => w.column),
    ].filter(Boolean) as string[];
    for (const r of refs) {
      if (r.indexOf('.') < 0) return '조인 시 컬럼은 "테이블.컬럼" 형식이어야 합니다.';
      if (!activeHandles.includes(parseColumn(r, tableHandle(cfg.table)).table ?? '')) return `조인에 없는 테이블 참조: ${r}`;
      cfg.seriesBy,
    }
  }
  const spatialGeoPoint = chartType === 'geoscatter' && cfg.geoPoint?.mode === 'spatial';
  const spatialGeoArea = chartType === 'map' && cfg.geoArea?.mode === 'spatial';
  if (!spatialGeoPoint && !spatialGeoArea && !cfg.xAxis) return 'X축 컬럼을 선택하세요.';
  if (!spatialGeoPoint && !spatialGeoArea && cfg.yAxis.length === 0) return 'Y축을 1개 이상 추가하세요.';
  if (!spatialGeoPoint && !spatialGeoArea && cfg.yAxis.some((y) => !y.column)) return 'Y축 컬럼을 선택하세요.';
  if (chartType === 'pie' && cfg.yAxis.length !== 1) return '원형 차트는 Y축을 1개만 사용할 수 있습니다.';
  if (chartType === 'map' && !spatialGeoArea && cfg.yAxis.length !== 1) return '지도 차트는 값 컬럼(Y축)을 1개만 사용할 수 있습니다.';
  const xType = columnType(cfg.xAxis, cfg, tables);
  const rawSeriesCount = cfg.yAxis.filter((y) => y.agg === 'none').length;
  if (chartType === 'boxplot') {
    if (cfg.yAxis.length !== 1) return '박스 플롯은 값 컬럼(Y축)을 1개만 사용할 수 있습니다.';
    if (cfg.yAxis.some((y) => y.agg !== 'none')) return '박스 플롯은 집계 없이 원본값만 사용합니다.';
    if (!isNumericType(columnType(cfg.yAxis[0]?.column, cfg, tables))) return '박스 플롯은 숫자 값 컬럼(Y축)이 필요합니다.';
  }
  if (chartType === 'geoscatter') {
    if (spatialGeoPoint) {
      const pointColumn = cfg.geoPoint?.spatialColumn;
      if (!pointColumn) return '공간 Point 컬럼을 선택하세요.';
      if (!isSpatialPointType(columnType(pointColumn, cfg, tables))) {
        return '지도 포인트 공간 컬럼은 SRID가 지정된 geometry/geography Point 타입이어야 합니다.';
      }
      if (cfg.geoPoint?.sizeColumn && !isNumericType(columnType(cfg.geoPoint.sizeColumn, cfg, tables))) {
        return '지도 포인트의 크기값 컬럼은 숫자여야 합니다.';
      }
      if (new Set(activeTables(cfg).map((table) => table.datasourceId)).size >= 2) {
        return '공간 Point 컬럼은 여러 데이터소스 조인에서 아직 사용할 수 없습니다.';
      }
      if (cfg.sample) return '지도 포인트 공간 컬럼 모드에서는 표본 추출을 사용할 수 없습니다.';
      return null;
    }
    if (cfg.yAxis.length > 2) return '지도 포인트는 위도(+선택 크기값) 최대 2개 컬럼만 사용할 수 있습니다.';
    if (cfg.yAxis.some((y) => y.agg !== 'none')) return '지도 포인트는 집계 없이 원본 좌표만 사용합니다.';
    if (!isNumericType(xType)) return '지도 포인트는 숫자 경도(X) 컬럼이 필요합니다.';
    if (cfg.yAxis.some((y) => !isNumericType(columnType(y.column, cfg, tables)))) return '지도 포인트의 위도·크기값 컬럼은 숫자여야 합니다.';
  }
  if (spatialGeoArea) {
    const areaColumn = cfg.geoArea?.spatialColumn;
    const nameColumn = cfg.geoArea?.nameColumn;
  if (cfg.seriesBy && !(chartType === 'bar' || chartType === 'line')) return '계열 기준은 막대와 선 차트에서만 사용할 수 있습니다.';
  if (cfg.seriesBy && cfg.yAxis.length !== 1) return '계열 기준을 사용하면 Y축 값은 1개만 선택할 수 있습니다.';
  if (cfg.seriesBy && cfg.seriesBy === cfg.xAxis) return 'X축과 계열 기준은 서로 다른 컬럼이어야 합니다.';
  if (cfg.seriesBy && !columnType(cfg.seriesBy, cfg, tables)) return '계열 기준 컬럼을 선택하세요.';
    const valueColumn = cfg.geoArea?.valueColumn;
    if (!areaColumn) return '공간 Polygon 컬럼을 선택하세요.';
    if (!isSpatialAreaType(columnType(areaColumn, cfg, tables))) {
      return '동적 지도 경계는 SRID가 지정된 geometry/geography Polygon 또는 MultiPolygon 타입이어야 합니다.';
    }
    if (!nameColumn) return '영역 이름 컬럼을 선택하세요.';
    if (!valueColumn) return '영역 값 컬럼을 선택하세요.';
    if (!isNumericType(columnType(valueColumn, cfg, tables))) return '동적 지도의 값 컬럼은 숫자여야 합니다.';
    if (new Set(activeTables(cfg).map((table) => table.datasourceId)).size >= 2) {
      return '공간 Polygon 컬럼은 여러 데이터소스 조인에서 아직 사용할 수 없습니다.';
    }
    if (cfg.sample) return '공간 Polygon 지도에서는 표본 추출을 사용할 수 없습니다.';
    return null;
  }
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

export function createSampleSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] & 0x7fffffff;
  }
  return Math.floor(Math.random() * 2_147_483_648);
}

// 표본 토글 ON → 자동(서버가 방식·크기 결정). 정확도는 절대 갯수가 결정하므로 auto 는 rate 를 싣지 않는다.
export function createSampleConfig() {
  return { mode: 'auto' as const, seed: createSampleSeed() };
}

export function updateSampleMode(
  sample: BuilderConfig['sample'],
  mode: SamplingMode,
  manualSize = DEFAULT_SAMPLE_SIZE,
) {
  const seed = sample?.seed ?? createSampleSeed();
  if (mode === 'auto') return { mode: 'auto' as const, seed };
  return { mode: 'manual' as const, size: normalizeSampleSize(sample?.size ?? manualSize), seed };
}

export function normalizeSampleConfig(sample: BuilderConfig['sample']): BuilderConfig['sample'] {
  if (!sample) return null;
  const mode = sample.mode === 'auto' ? 'auto' : 'manual';
  const normalized: NonNullable<BuilderConfig['sample']> = {
    mode,
    seed: Number.isInteger(sample.seed) ? sample.seed : DEFAULT_SAMPLE_SEED,
  };
  if (mode === 'manual' && sample.size != null) normalized.size = normalizeSampleSize(sample.size);
  if (sample.rate != null) normalized.rate = normalizeSampleRate(sample.rate); // 레거시 SYSTEM 핀 보존
  if (sample.method != null) normalized.method = sample.method;
  return normalized;
}

export function emptyBuilder(): BuilderConfig {
  return { table: null, joins: [], xAxis: null, xAxisBucket: null, seriesBy: null, seriesOrder: 'asc', yAxis: [], where: [], orderBy: null, sample: null };
}

export function normalizeBuilder(cfg: BuilderConfig): BuilderConfig {
  return { ...emptyBuilder(), ...cfg, joins: cfg.joins ?? [], sample: normalizeSampleConfig(cfg.sample) };
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
  return { ...cfg, table: base, joins, sample: normalizeSampleConfig(cfg.sample) };
}

/** orderBy 대상 라벨 (x = X축, y{i} = i번째 시리즈 별칭) */
export function orderTargets(cfg: BuilderConfig): { value: string; label: string }[] {
  const targets = [{ value: 'x', label: cfg.xAxis ? `${cfg.xAxis} (X)` : 'X축' }];
  cfg.yAxis.forEach((y, i) => {
    targets.push({ value: `y${i}`, label: `${y.alias || (y.agg === 'none' ? y.column : `${y.agg}_${y.column}`)} (Y${i + 1})` });
  });
  return targets;
}
