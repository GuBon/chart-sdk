// API 계약서 v1.4 도메인 타입. 서버 응답 형태와 1:1.
// options JSONB 키는 chart-options/optionRegistry.ts(SSOT)를 따른다 — 여기선 느슨한 맵으로 둔다.

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter';
export type DefineMode = 'builder' | 'sql';
export type RefreshMode = 'live' | 'ttl' | 'manual';

export type ChartOptions = Record<string, unknown>;

// 노코드 빌더 (SQL 생성규칙 2장)
export type AggType = 'sum' | 'avg' | 'stddev' | 'count' | 'count_distinct' | 'min' | 'max' | 'none';
export type WhereOp =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'starts_with' | 'in' | 'between' | 'is_null' | 'is_not_null';
export type XAxisBucket = 'day' | 'week' | 'month' | null;

export interface YAxisField {
  column: string;
  agg: AggType;
  alias?: string;
}
export interface WhereCond {
  column: string;
  op: WhereOp;
  value?: string | number | (string | number)[];
}
/** target: 'x' 또는 'y{인덱스}' */
export interface OrderBy {
  target: string;
  direction: 'asc' | 'desc';
}

/** 표본 추출 (생성규칙 3C) — 대용량 테이블 일부만 스캔해 근사 집계. method 는 SYSTEM 고정(블록 단위, 전체 스캔 회피). */
export interface SampleConfig {
  rate: number; // 표본 비율(%) 1~100
}

/**
 * 소스·스키마 한정 테이블 참조(다중 데이터소스 페더레이션). 백엔드 §12.3 과 1:1 — 컬럼 참조는 "handle.col" 문자열.
 * handle: 한 차트 내 이 테이블의 유일 식별자. 기본은 name, 서로 다른 소스/스키마의 동명 테이블이 겹칠 때만 접미(users_2)로 구분.
 */
export interface TableRef {
  datasourceId: number;
  schema: string;
  name: string;
  handle?: string;
}

export type JoinType = 'inner' | 'left';
/** 테이블 조인 (생성규칙 11장). N개 체인 — 각 on.leftColumn 은 base 또는 앞서 조인된 테이블의 qualified 컬럼. */
export interface JoinSpec {
  table: TableRef; // 조인 대상 테이블(소스 한정 — 다른 데이터소스도 가능)
  type: JoinType; // inner | left (full/right 는 후속)
  on: { leftColumn: string; rightColumn: string }; // qualified "table.col" 단일 매칭
}

export interface BuilderConfig {
  table: TableRef | null; // base 테이블. 신규 차트 초안에선 null 허용
  // 조인이 있으면 모든 컬럼 참조(xAxis·yAxis·where·orderBy·on)는 qualified "table.col". 없으면 기존 "col" 허용(하위호환).
  joins?: JoinSpec[]; // 생성규칙 11장. 미지정/[] = 단일 테이블
  xAxis: string | null;
  xAxisBucket: XAxisBucket;
  yAxis: YAxisField[];
  where: WhereCond[];
  orderBy: OrderBy | null;
  limit?: number;
  sample?: SampleConfig | null; // 집계 모드 전용. 지정 시 FROM 에 TABLESAMPLE SYSTEM 주입. 조인과 동시 사용 불가(11장)
}

/** S1 목록 카드 */
export interface ChartSummary {
  id: number;
  name: string;
  description: string | null;
  chartType: ChartType;
  datasourceId: number;
  updatedAt: string;
}

/** S1 목록 정렬·필터 (API 3.1). 전부 선택 — 미지정 시 owner 범위 전체를 updated_at DESC 로 */
export type ChartSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
export interface ChartListParams {
  q?: string;
  type?: ChartType | 'all';
  datasourceId?: number | 'all';
  sort?: ChartSort;
  page?: number;
  pageSize?: number;
}

export interface ChartListResponse {
  charts: ChartSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** S2 진입 시 복원용 단건 */
export interface Chart {
  id: number;
  name: string;
  description: string | null;
  datasourceId: number;
  defineMode: DefineMode;
  sqlQuery: string;
  builderConfig: BuilderConfig;
  chartType: ChartType;
  options: ChartOptions;
  refreshMode: RefreshMode;
  cacheTtlSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export type ChartInput = Omit<Chart, 'id' | 'createdAt' | 'updatedAt'>;

/** 데이터소스 — 비밀번호는 응답에 절대 포함되지 않는다 */
export interface Datasource {
  id: number;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  dbUser: string;
  maxPoolSize: number;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

export interface DatasourceInput {
  name: string;
  host: string;
  port: number;
  databaseName: string;
  dbUser: string;
  dbPassword?: string; // 전달 시에만 변경
  maxPoolSize?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

export interface UserToken {
  tokenId: number;
  userId: number;
  expiresAt: string;
  isActive: boolean;
  createdAt?: string;
  token?: string; // 원문 JWT (PRD 8.2 트레이드오프 — 임베드 스니펫 조립용)
}

/** 발급 직후에만 원문 token 을 반환 */
export interface IssuedToken extends UserToken {
  token: string;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
}

/** 스키마 탐색(S2 좌측). datasourceId 는 이 테이블이 속한 데이터소스(클라이언트가 로드 시 태깅) — 다중 소스 조인 식별에 쓴다. */
export interface SchemaTable {
  datasourceId: number;
  schema: string;
  name: string;
  columns: { name: string; type: string }[];
}

/** query/run · run-builder · 테이블 미리보기 공통 결과 */
export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  generatedSql?: string;
  option?: ChartOptions; // run-builder(aggregate) · preview 에서 동봉
  approximate?: boolean; // 표본 추출로 계산된 근사 결과
  sampleRate?: number; // 사용된 표본 비율(%) — approximate 일 때만
}

/** 임베드 데이터(SDK 가 받는 형태) */
export interface ChartDataResponse {
  chartId: number;
  computedAt: string;
  rowCount?: number;
  truncated?: boolean;
  option: ChartOptions;
}

export interface ChartPreviewBatchResponse {
  previews: Record<string, ChartDataResponse>;
  errors: Record<string, string>;
}
