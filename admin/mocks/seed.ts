// 개발용 시드 데이터 — S1 화면(183:16)의 카드 구성과 일치시킨다.
import type { Chart, ChartSummary, Datasource, SchemaTable, User, UserToken } from '@/lib/api/types';

const DATASOURCE_NAMES: Record<number, string> = {
  1: 'analytics-db',
  2: 'sales-db',
  3: 'legacy-dw',
};

export const charts: ChartSummary[] = ([
  // 최신 5개(6월) — updated_desc 기본 정렬에서 1페이지 앞자리. s1/s3 기존 테스트의 "첫 카드=월별 매출" 전제 보존.
  { id: 12, name: '월별 매출', description: '영업부 매출을 월 단위로 집계', chartType: 'bar', datasourceId: 2, updatedAt: '2026-06-10T09:30:00Z' },
  { id: 13, name: '일별 방문자', description: '서비스 일별 방문자(UV) 추이', chartType: 'line', datasourceId: 1, updatedAt: '2026-06-09T14:00:00Z' },
  { id: 14, name: '카테고리별 판매', description: '상품 카테고리별 판매량 비교', chartType: 'bar', datasourceId: 2, updatedAt: '2026-06-08T11:20:00Z' },
  { id: 15, name: '분기별 이익', description: null, chartType: 'pie', datasourceId: 2, updatedAt: '2026-06-05T16:45:00Z' },
  { id: 16, name: '시간대별 트래픽', description: '시간대별 API 요청 수', chartType: 'line', datasourceId: 1, updatedAt: '2026-06-03T08:10:00Z' },
  // 추가 8개(5월) — 페이지네이션(총 13 = 12+1)·종류/데이터소스 필터·정렬 검증용. 전부 6월보다 과거라 2페이지로 밀리는 건 #24 하나뿐.
  // '가격대별 분포'는 name_asc 정렬에서 결정적 첫 항목(ㄱ 초성). scatter 2개(17·18)로 종류 필터 '분포' 검증.
  { id: 17, name: '가격대별 분포', description: '상품 가격대 산포', chartType: 'scatter', datasourceId: 1, updatedAt: '2026-05-28T09:00:00Z' },
  { id: 18, name: '지역별 고객 분포', description: '지역별 고객 산포', chartType: 'scatter', datasourceId: 2, updatedAt: '2026-05-25T09:00:00Z' },
  { id: 19, name: '부서별 지출', description: '부서별 지출 합계', chartType: 'bar', datasourceId: 1, updatedAt: '2026-05-22T09:00:00Z' },
  { id: 20, name: '채널별 전환율', description: '유입 채널별 전환', chartType: 'line', datasourceId: 2, updatedAt: '2026-05-19T09:00:00Z' },
  { id: 21, name: '등급별 회원', description: '회원 등급 분포', chartType: 'pie', datasourceId: 2, updatedAt: '2026-05-16T09:00:00Z' },
  { id: 22, name: '요일별 주문', description: '요일별 주문 수', chartType: 'bar', datasourceId: 1, updatedAt: '2026-05-13T09:00:00Z' },
  { id: 23, name: '상품별 재고', description: '상품별 재고량', chartType: 'bar', datasourceId: 2, updatedAt: '2026-05-10T09:00:00Z' },
  { id: 24, name: '월별 순이익', description: '월별 순이익 추이', chartType: 'line', datasourceId: 1, updatedAt: '2026-05-05T09:00:00Z' },
] satisfies Array<Omit<ChartSummary, 'mainTable'>>).map((chart) => ({
  ...chart,
  mainTable: {
    datasourceId: chart.datasourceId,
    datasourceName: DATASOURCE_NAMES[chart.datasourceId],
    schema: 'public',
    name: 'sales',
  },
}));

export const datasources: Datasource[] = [
  { id: 1, name: DATASOURCE_NAMES[1], host: 'db.internal', port: 5432, databaseName: 'analytics', dbUser: 'reader', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: true },
  { id: 2, name: DATASOURCE_NAMES[2], host: '10.0.3.21', port: 5432, databaseName: 'sales', dbUser: 'readonly', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: true },
  { id: 3, name: DATASOURCE_NAMES[3], host: '10.0.7.8', port: 5433, databaseName: 'warehouse', dbUser: 'dw', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: false },
];

/** 삭제 시 영향받는 차트 수(409 경고용 목 데이터) */
export const datasourceUsage: Record<number, number> = { 1: 3, 2: 2, 3: 0 };

/** S2 스키마 탐색기용 테이블/컬럼. datasourceId 로 소속 소스를 태깅 — 다중 소스 조인 데모 포함. */
export const schemaTables: SchemaTable[] = [
  // 데이터소스 1 (analytics-db)
  {
    datasourceId: 1,
    schema: 'public',
    name: 'sales',
    relationType: 'TABLE',
    estimatedRowCount: 500_000_000,
    columns: [
      { name: 'id', type: 'int' },
      { name: 'category', type: 'text' },
      { name: 'amount', type: 'numeric' },
      { name: 'dept', type: 'text' },
      { name: 'date', type: 'date' },
      { name: 'customer_id', type: 'int' },
      { name: 'location', type: 'geometry(Point,4326)' },
      { name: 'service_area', type: 'geometry(Polygon,4326)' },
      { name: 'service_area_geog', type: 'geography(MultiPolygon,4326)' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'public',
    name: 'users',
    relationType: 'TABLE',
    estimatedRowCount: 2_500_000,
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'text' },
      { name: 'created_at', type: 'timestamp' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'public',
    name: 'visits',
    relationType: 'TABLE',
    estimatedRowCount: 80_000_000,
    columns: [
      { name: 'id', type: 'int' },
      { name: 'path', type: 'text' },
      { name: 'visited_at', type: 'timestamp' },
    ],
  },
  // 조인 데모(생성규칙 11장): sales.id ↔ orders.sale_id, orders.prod_id ↔ products.id
  {
    datasourceId: 1,
    schema: 'public',
    name: 'orders',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'sale_id', type: 'int' },
      { name: 'prod_id', type: 'int' },
      { name: 'amount', type: 'numeric' },
      { name: 'status', type: 'text' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'public',
    name: 'products',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'text' },
      { name: 'category', type: 'text' },
      { name: 'price', type: 'numeric' },
    ],
  },
  // 비-public 스키마 데모(§1.2): 식별자는 "analytics.events" 로 한정된다.
  {
    datasourceId: 1,
    schema: 'analytics',
    name: 'events',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'kind', type: 'text' },
      { name: 'value', type: 'numeric' },
      { name: 'occurred_at', type: 'timestamp' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'public',
    name: 'regional_population',
    relationType: 'TABLE',
    estimatedRowCount: 68,
    columns: [
      { name: 'region', type: 'text' },
      { name: 'year', type: 'int' },
      { name: 'population', type: 'bigint' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'analytics',
    name: 'sales_summary',
    relationType: 'VIEW',
    columns: [
      { name: 'category', type: 'text' },
      { name: 'amount', type: 'numeric' },
      { name: 'date', type: 'date' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'analytics',
    name: 'monthly_sales_mv',
    relationType: 'MATERIALIZED_VIEW',
    populated: true,
    estimatedRowCount: 24,
    columns: [
      { name: 'month', type: 'date' },
      { name: 'category', type: 'text' },
      { name: 'amount', type: 'numeric' },
    ],
  },
  {
    datasourceId: 1,
    schema: 'analytics',
    name: 'stale_sales_mv',
    relationType: 'MATERIALIZED_VIEW',
    populated: false,
    columns: [
      { name: 'month', type: 'date' },
      { name: 'amount', type: 'numeric' },
    ],
  },
  // 데이터소스 2 (sales-db) — 다중 소스 조인 데모: sales.customer_id(ds1) ↔ customers.id(ds2)
  {
    datasourceId: 2,
    schema: 'public',
    name: 'customers',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'region', type: 'text' },
      { name: 'grade', type: 'text' },
    ],
  },
  // 동명 테이블 크로스소스 조인 데모: ds1.public.users ↔ ds2.public.users(같은 이름, 다른 소스). 핸들(users/users_2)로 구분.
  {
    datasourceId: 2,
    schema: 'public',
    name: 'users',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'region', type: 'text' },
      { name: 'tier', type: 'text' },
    ],
  },
  // 대형 스키마 페이지네이션·정렬 검증용 — legacy-dw(ds3)에 bulk 테이블 60개(50/페이지 → 2페이지). name 은 zero-pad 라 정렬이 결정적(bulk_table_60 = 이름 내림차순 첫 항목).
  ...Array.from({ length: 60 }, (_, i) => ({
    datasourceId: 3,
    schema: 'public',
    name: `bulk_table_${String(i + 1).padStart(2, '0')}`,
    relationType: 'TABLE' as const,
    columns: [
      { name: 'id', type: 'int' },
      { name: 'amount', type: 'numeric' },
      { name: 'created_at', type: 'date' },
    ],
  })),
  // 스키마 필터 검증용 — legacy-dw(ds3)의 비-public 스키마(archive). 사이드바 스키마 필터 섹션은 스키마 2개 이상일 때만 노출.
  {
    datasourceId: 3,
    schema: 'archive',
    name: 'events',
    relationType: 'TABLE',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'kind', type: 'text' },
      { name: 'occurred_at', type: 'date' },
    ],
  },
];

export const users: User[] = [
  { id: 7, username: 'kim.gy', displayName: '김건영' },
  { id: 8, username: 'lee.sh', displayName: '이서현' },
  { id: 9, username: 'park.jw', displayName: '박지원' },
  { id: 10, username: 'choi.mn', displayName: '최민' },
];

// figma S7 목록과 일치: kim·lee 활성, park 만료(exp 과거), choi 회수됨(isActive=false). 1인 1활성.
export const tokens: UserToken[] = [
  { tokenId: 42, userId: 7, createdAt: '2026-06-10T00:00:00Z', expiresAt: '2027-06-10T00:00:00Z', isActive: true, token: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjcsImp0aSI6NDJ9.a8Xk' },
  { tokenId: 43, userId: 8, createdAt: '2026-05-02T00:00:00Z', expiresAt: '2027-05-02T00:00:00Z', isActive: true, token: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjgsImp0aSI6NDN9.Q2mP' },
  { tokenId: 44, userId: 9, createdAt: '2025-12-15T00:00:00Z', expiresAt: '2026-06-01T00:00:00Z', isActive: true, token: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjksImp0aSI6NDR9.t7Rd' },
  { tokenId: 45, userId: 10, createdAt: '2026-01-20T00:00:00Z', expiresAt: '2027-01-20T00:00:00Z', isActive: false, token: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjEwLCJqdGkiOjQ1fQ.k9Lw' },
];

/** /charts/:id 복원용 상세(목록 항목을 기반으로 빌더 기본형 부여) */
export function chartDetail(summary: ChartSummary): Chart {
  return {
    ...summary, // chartType·datasourceId 포함
    defineMode: 'builder',
    sqlQuery: 'SELECT category, SUM(amount) AS total FROM sales GROUP BY category',
    builderConfig: { table: { datasourceId: summary.datasourceId, schema: 'public', name: 'sales' }, xAxis: 'category', xAxisBucket: null, yAxis: [{ column: 'amount', agg: 'sum' }], where: [], orderBy: null, sample: null },
    options: { legend: { show: true } },
    refreshMode: 'ttl',
    cacheTtlSeconds: 3600,
    createdAt: '2026-06-01T10:00:00Z',
  };
}
