// API 계약서 v1.4 도메인 타입. 서버 응답 형태와 1:1.
// options JSONB 키는 chart-options/optionRegistry.ts(SSOT)를 따른다 — 여기선 느슨한 맵으로 둔다.

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter';
export type DefineMode = 'builder' | 'sql';
export type RefreshMode = 'live' | 'ttl' | 'manual';

export type ChartOptions = Record<string, unknown>;

// 노코드 빌더 (SQL 생성규칙 2장)
export type AggType = 'sum' | 'avg' | 'count' | 'count_distinct' | 'min' | 'max';
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

export interface BuilderConfig {
  table: string | null; // 신규 차트 초안에선 null 허용
  xAxis: string | null;
  xAxisBucket: XAxisBucket;
  yAxis: YAxisField[];
  where: WhereCond[];
  orderBy: OrderBy | null;
  limit?: number;
}

/** S1 목록 카드 */
export interface ChartSummary {
  id: number;
  name: string;
  description: string | null;
  chartType: ChartType;
  updatedAt: string;
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

/** 스키마 탐색(S2 좌측) */
export interface SchemaTable {
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
}

/** 임베드 데이터(SDK 가 받는 형태) */
export interface ChartDataResponse {
  chartId: number;
  computedAt: string;
  option: ChartOptions;
}
