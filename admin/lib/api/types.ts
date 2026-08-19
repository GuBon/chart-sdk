import type { SamplingMetadata, SamplingMode } from '@chartsdk/chart-options/sampling';

// API 계약서 v2.5 도메인 타입. 서버 응답 형태와 1:1.
// options JSONB 키는 chart-options/optionRegistry.ts(SSOT)를 따른다 — 여기선 느슨한 맵으로 둔다.

export type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'boxplot' | 'heatmap' | 'map' | 'geoscatter';
export type GeoSeriesType = 'map' | 'heatmap' | 'scatter' | 'effectScatter';
export type DefineMode = 'builder' | 'sql';
export type RefreshMode = 'live' | 'manual';

export type ChartOptions = Record<string, unknown>;

// 노코드 빌더 (SQL 생성규칙 2장)
export type AggType = 'sum' | 'avg' | 'stddev' | 'variance' | 'count' | 'count_distinct' | 'min' | 'max' | 'none';
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

/**
 * 표본 설정 (생성규칙 3C v7) — 무편향 표본은 목표 갯수(size)가 추정 정밀도를 결정한다.
 * auto: 서버가 방식·크기 결정 / manual: size(갯수) 지정. rate·method 는 레거시 SYSTEM 핀 전용.
 */
export interface SampleConfig {
  mode?: SamplingMode; // 'auto'(서버 결정) | 'manual'(size 지정). legacy {rate}는 manual로 승격
  size?: number; // 수동 표본 크기(행) 1000~50000
  rate?: number; // 레거시/SYSTEM 핀 전용(%). 서버는 있으면 SYSTEM 비율로 사용
  method?: 'auto' | 'system'; // 'auto'(기본, INDEX_RANDOM+폴백) | 'system'(레거시 블록 표본 강제)
  seed?: number; // legacy 미지정은 공용 기본 seed로 승격
}

/** 포인트 지도 좌표 입력. 미지정/columns는 기존 경도·위도 컬럼 방식이다. */
export interface GeoPointConfig {
  mode: 'columns' | 'spatial';
  spatialColumn?: string | null; // PostGIS geometry/geography(Point, SRID)
  nameColumn?: string | null; // 라벨·툴팁에 표시할 선택적 이름
  valueColumn?: string | null; // 툴팁/데이터 값에 사용할 선택적 숫자
  sizeColumn?: string | null; // 점 크기에 사용할 선택적 숫자
}

/** 지도 경계 입력. regions는 내장 행정구역, spatial은 DB Polygon/MultiPolygon 컬럼이다. */
export interface GeoAreaConfig {
  mode: 'regions' | 'spatial';
  spatialColumn?: string | null; // PostGIS geometry/geography(Polygon|MultiPolygon, SRID)
  nameColumn?: string | null; // ECharts feature 이름과 툴팁에 사용할 컬럼(고유값 권장)
  valueColumn?: string | null; // visualMap에 사용할 숫자 원본값
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

/** 차트 응답의 기준 관계. URL 생성용 현재 데이터소스 이름은 저장 정의가 아닌 읽기 모델에만 포함한다. */
export interface ChartMainTable extends TableRef {
  datasourceName: string;
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
  /** 막대·선 전용 두 번째 그룹 차원. 결과는 X × 계열 피벗으로 표시한다. */
  seriesBy?: string | null;
  seriesOrder?: 'asc' | 'desc' | 'data';
  yAxis: YAxisField[];
  where: WhereCond[];
  orderBy: OrderBy | null;
  limit?: number;
  sample?: SampleConfig | null; // 집계·원본값 공용 행 표본. 물리 테이블은 INDEX_RANDOM/SYSTEM, 조인·VIEW는 RESULT_RANDOM.
  /** 지도 대분류 안의 실제 ECharts series.type. 구 저장 데이터는 chartType별 기본형으로 해석한다. */
  geoSeriesType?: GeoSeriesType;
  geoPoint?: GeoPointConfig; // geoscatter와 map/heatmap 공용. 미지정은 경도(X)+위도(Y) 컬럼 방식.
  geoArea?: GeoAreaConfig; // map/영역 전용. 미지정/regions는 내장 행정구역 방식.
  /**
   * 필드를 차트에 연결했을 때의 데이터소스 표시 이름 스냅샷.
   * 키는 실제 컬럼 참조이며 SQL 생성에는 사용하지 않는다.
   */
  fieldDisplayNames?: Record<string, string>;
}

/** S1 목록 카드 */
export interface ChartSummary {
  id: number;
  name: string;
  description: string | null;
  chartType: ChartType;
  datasourceId: number;
  /** builderConfig.table에서 추출한 메인 관계. 정식 편집 URL과 관계별 차트 목록에 사용한다. */
  mainTable: ChartMainTable;
  /** 소유자 사용자 id. owner가 없는 레거시 차트는 null. 관리자 목록에서 내 차트/타인 차트(읽기 전용) 구분에 쓴다. */
  ownerId: number | null;
  /** owner가 없는 레거시 차트는 null. */
  authorName: string | null;
  updatedAt: string;
}

/** S1 목록 정렬·필터 (API 3.1). 전부 선택 — 미지정 시 owner 범위 전체를 updated_at DESC 로 */
export type ChartSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
export interface ChartListParams {
  q?: string;
  type?: ChartType | 'all';
  datasourceId?: number | 'all';
  schema?: string;
  relation?: string;
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
  version: number;
  name: string;
  description: string | null;
  datasourceId: number;
  mainTable: ChartMainTable; // builderConfig.table + 현재 데이터소스 이름에서 파생한 읽기 전용 응답.
  defineMode: DefineMode;
  sqlQuery: string;
  builderConfig: BuilderConfig;
  chartType: ChartType;
  options: ChartOptions;
  refreshMode: RefreshMode;
  createdAt: string;
  updatedAt: string;
}

export type ChartInput = Omit<Chart, 'id' | 'version' | 'mainTable' | 'createdAt' | 'updatedAt'> & {
  /** Optimistic-lock token returned by the most recent create/get/update response. */
  version?: number;
};

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

export type EmbedKeyStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

/** 목록에서 노출 가능한 임베드 키 메타데이터. Bearer 원문은 포함하지 않는다. */
export interface EmbedKeySummary {
  id: number;
  chartId: number;
  userId: number;
  expiresAt: string;
  status: EmbedKeyStatus;
  createdAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
}

/** 발급 성공 시 한 번만 반환되는 원문 키. 브라우저 영속 저장소에 보관하지 않는다. */
export interface IssuedEmbedKey extends EmbedKeySummary {
  status: 'ACTIVE';
  embedKey: string;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
}

export type UserRole = 'member' | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AdminUserSummary {
  id: number;
  username: string;
  displayName: string | null;
  role: UserRole;
  active: boolean;
  createdAt: string;
  chartCount: number;
  embeddedChartCount: number;
  activeSessions: number;
}

export interface AdminUserListResponse {
  users: AdminUserSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminEmbedKeySummary {
  id: number;
  chartId: number;
  chartName: string;
  status: EmbedKeyStatus;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface AdminUserDetailResponse {
  user: Omit<AdminUserSummary, 'chartCount' | 'embeddedChartCount' | 'activeSessions'>;
  summary: {
    activeSessions: number;
    chartCount: number;
    embeddedChartCount: number;
    activeEmbedKeyCount: number;
    expiredEmbedKeyCount: number;
    revokedEmbedKeyCount: number;
    lastEmbedKeyIssuedAt: string | null;
  };
  embedKeys: AdminEmbedKeySummary[];
}

export interface AdminChartSummary {
  id: number;
  ownerId: number | null;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  name: string;
  description: string | null;
  chartType: ChartType;
  refreshMode: RefreshMode;
  createdAt: string;
  updatedAt: string;
}

export interface AdminChartDetail extends AdminChartSummary {
  datasourceId: number;
  datasourceName: string | null;
  defineMode: DefineMode;
  sqlQuery: string;
  builderConfig: BuilderConfig;
  options: ChartOptions;
  version: number;
}

/** 스키마 탐색(S2 좌측). datasourceId 는 이 테이블이 속한 데이터소스(클라이언트가 로드 시 태깅) — 다중 소스 조인 식별에 쓴다. */
export type RelationType = 'TABLE' | 'VIEW' | 'MATERIALIZED_VIEW';

export interface SchemaTable {
  datasourceId: number;
  schema: string;
  name: string;
  displayName?: string;
  relationType: RelationType;
  populated?: boolean; // MATERIALIZED_VIEW 전용. false이면 REFRESH 전까지 조회할 수 없다.
  estimatedRowCount?: number; // pg_class.reltuples 기반 계획용 추정치 — 표본 계획·전량 폴백·UI 안내에만 사용
  columns: { name: string; displayName?: string; type: string }[];
}

/** query/run · run-builder · 테이블 미리보기 공통 결과 */
export interface QueryResult {
  columns: { name: string; displayName?: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  generatedSql?: string;
  option?: ChartOptions; // run-builder(aggregate) · preview 에서 동봉
  sampling?: SamplingMetadata; // 정식 표본 메타데이터 계약
  approximate?: boolean; // 표본 추출로 계산된 근사 결과
  sampleRate?: number; // 레거시 하위 호환 별칭 — 신규 코드는 sampling.rate 사용
}

/** 임베드 데이터(SDK 가 받는 형태) */
export interface ChartDataResponse {
  chartId: number;
  computedAt: string;
  rowCount?: number;
  truncated?: boolean;
  /** 단건 편집 미리보기에서만 제공. 목록 batch는 payload 절감을 위해 생략한다. */
  columns?: { name: string; displayName?: string; type: string }[];
  rows?: unknown[][];
  elapsedMs?: number;
  sampling?: SamplingMetadata;
  approximate?: boolean;
  sampleRate?: number;
  option: ChartOptions;
}

/** 저장 차트 캐시를 즉시 다시 계산한 결과 */
export interface ChartRefreshResponse {
  chartId: number;
  computedAt: string;
  rowCount: number;
  elapsedMs: number;
  sampling?: SamplingMetadata | null;
  approximate?: boolean;
  sampleRate?: number | null;
}

export interface ChartPreviewBatchResponse {
  previews: Record<string, ChartDataResponse>;
  errors: Record<string, string>;
}
