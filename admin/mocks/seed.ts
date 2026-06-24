// 개발용 시드 데이터 — S1 화면(183:16)의 카드 구성과 일치시킨다.
import type { Chart, ChartSummary, Datasource, SchemaTable, User, UserToken } from '@/lib/api/types';

export const charts: ChartSummary[] = [
  { id: 12, name: '월별 매출', description: '영업부 매출을 월 단위로 집계', chartType: 'bar', datasourceId: 2, updatedAt: '2026-06-10T09:30:00Z' },
  { id: 13, name: '일별 방문자', description: '서비스 일별 방문자(UV) 추이', chartType: 'line', datasourceId: 1, updatedAt: '2026-06-09T14:00:00Z' },
  { id: 14, name: '카테고리별 판매', description: '상품 카테고리별 판매량 비교', chartType: 'bar', datasourceId: 2, updatedAt: '2026-06-08T11:20:00Z' },
  { id: 15, name: '분기별 이익', description: null, chartType: 'pie', datasourceId: 2, updatedAt: '2026-06-05T16:45:00Z' },
  { id: 16, name: '시간대별 트래픽', description: '시간대별 API 요청 수', chartType: 'line', datasourceId: 1, updatedAt: '2026-06-03T08:10:00Z' },
];

export const datasources: Datasource[] = [
  { id: 1, name: 'analytics-db', host: 'db.internal', port: 5432, databaseName: 'analytics', dbUser: 'reader', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: true },
  { id: 2, name: 'sales-db', host: '10.0.3.21', port: 5432, databaseName: 'sales', dbUser: 'readonly', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: true },
  { id: 3, name: 'legacy-dw', host: '10.0.7.8', port: 5433, databaseName: 'warehouse', dbUser: 'dw', maxPoolSize: 5, lastTestedAt: '2026-06-19T10:00:00Z', lastTestOk: false },
];

/** 삭제 시 영향받는 차트 수(409 경고용 목 데이터) */
export const datasourceUsage: Record<number, number> = { 1: 3, 2: 2, 3: 0 };

/** S2 스키마 탐색기용 테이블/컬럼 (figma 258:184 트리와 일치) */
export const schemaTables: SchemaTable[] = [
  {
    name: 'sales',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'category', type: 'text' },
      { name: 'amount', type: 'numeric' },
      { name: 'dept', type: 'text' },
      { name: 'date', type: 'date' },
    ],
  },
  {
    name: 'users',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'text' },
      { name: 'created_at', type: 'timestamp' },
    ],
  },
  {
    name: 'visits',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'path', type: 'text' },
      { name: 'visited_at', type: 'timestamp' },
    ],
  },
  // 조인 데모(생성규칙 11장): sales.id ↔ orders.sale_id, orders.prod_id ↔ products.id
  {
    name: 'orders',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'sale_id', type: 'int' },
      { name: 'prod_id', type: 'int' },
      { name: 'amount', type: 'numeric' },
      { name: 'status', type: 'text' },
    ],
  },
  {
    name: 'products',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'text' },
      { name: 'category', type: 'text' },
      { name: 'price', type: 'numeric' },
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
    builderConfig: { table: 'sales', xAxis: 'category', xAxisBucket: null, yAxis: [{ column: 'amount', agg: 'sum' }], where: [], orderBy: null, sample: null },
    options: { colorMode: 'palette', legend: { show: true } },
    refreshMode: 'ttl',
    cacheTtlSeconds: 3600,
    createdAt: '2026-06-01T10:00:00Z',
  };
}
