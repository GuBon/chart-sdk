// 리소스별 타입 안전 엔드포인트. 화면은 이 함수들만 호출한다(경로·메서드 노출 금지).
import { request } from './client';
import type {
  Chart,
  ChartDataResponse,
  ChartInput,
  ChartListParams,
  ChartListResponse,
  ChartSummary,
  ChartPreviewBatchResponse,
  ChartRefreshResponse,
  ConnectionTestResult,
  Datasource,
  DatasourceInput,
  IssuedToken,
  QueryResult,
  SchemaTable,
  User,
  UserToken,
} from './types';

export { ApiError } from './client';
export type * from './types';

const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries as [string, string][])}` : '';
};

export const chartsApi = {
  list: (params: ChartListParams = {}) =>
    request<ChartListResponse | ChartListResponse['charts']>(
      `/charts${qs({
        q: params.q,
        type: params.type && params.type !== 'all' ? params.type : undefined,
        datasourceId: params.datasourceId && params.datasourceId !== 'all' ? params.datasourceId : undefined,
        schema: params.schema,
        relation: params.relation,
        sort: params.sort && params.sort !== 'updated_desc' ? params.sort : undefined,
        page: params.page && params.page > 1 ? params.page : undefined,
        pageSize: params.pageSize,
      })}`,
    ).then((res) => normalizeChartList(res, params)),
  get: (id: number) => request<Chart>(`/charts/${id}`),
  preview: (id: number) => request<ChartDataResponse>(`/charts/${id}/preview`),
  previews: (ids: number[]) =>
    ids.length
      ? request<ChartPreviewBatchResponse>(`/charts/previews${qs({ ids: ids.join(',') })}`)
      : Promise.resolve<ChartPreviewBatchResponse>({ previews: {}, errors: {} }),
  refresh: (id: number) => request<ChartRefreshResponse>(`/charts/${id}/refresh`, { method: 'POST' }),
  create: (input: ChartInput) => request<Chart>('/charts', { method: 'POST', body: input }),
  update: (id: number, input: ChartInput) => request<Chart>(`/charts/${id}`, { method: 'PUT', body: input }),
  remove: (id: number) => request<void>(`/charts/${id}`, { method: 'DELETE' }),
};

function normalizeChartList(res: ChartListResponse | ChartListResponse['charts'], params: ChartListParams): ChartListResponse {
  if (!Array.isArray(res)) {
    return { ...res, charts: res.charts.map(normalizeChartSummary) };
  }
  const charts = res.map(normalizeChartSummary);
  const pageSize = params.pageSize ?? charts.length;
  return {
    charts,
    page: params.page ?? 1,
    pageSize,
    total: charts.length,
    totalPages: 1,
  };
}

function normalizeChartSummary(chart: ChartSummary): ChartSummary {
  return {
    ...chart,
    authorName: chart.authorName ?? null,
  };
}

export const queryApi = {
  /** 노코드 미리보기 — rows + option 동봉 */
  runBuilder: (body: { datasourceId: number; builderConfig: unknown; chartType: string; options: unknown; mode?: 'aggregate' | 'rows' }) =>
    request<QueryResult>('/query/run-builder', { method: 'POST', body }),
  /** SQL 재실행 없이 option 만 재조립 */
  preview: (body: {
    chartType: string;
    options: unknown;
    builderConfig?: unknown;
    rows: { columns: unknown[]; rows: unknown[][] };
  }) =>
    request<{ option: Record<string, unknown> }>('/charts/preview', { method: 'POST', body }),
};

export const datasourcesApi = {
  list: () => request<{ datasources: Datasource[] }>('/datasources').then((r) => r.datasources),
  create: (input: DatasourceInput) => request<Datasource>('/datasources', { method: 'POST', body: input }),
  update: (id: number, input: DatasourceInput) => request<Datasource>(`/datasources/${id}`, { method: 'PUT', body: input }),
  remove: (id: number) => request<void>(`/datasources/${id}`, { method: 'DELETE' }),
  test: (input: Omit<DatasourceInput, 'name'> & { id?: number }) => request<ConnectionTestResult>('/datasources/test', { method: 'POST', body: input }),
};

export const schemaApi = {
  // 백엔드 응답에는 datasourceId 가 없으므로 조회한 소스로 태깅한다(다중 소스 조인 식별).
  tables: (datasourceId: number) =>
    request<{ tables: Omit<SchemaTable, 'datasourceId'>[] }>(`/schema/tables${qs({ datasourceId })}`)
      .then((r) => r.tables.map((t) => ({ ...t, datasourceId }))),
  preview: (schema: string, tableName: string, datasourceId: number) =>
    request<QueryResult>(`/schema/tables/${encodeURIComponent(tableName)}/preview${qs({ schema, datasourceId })}`),
  updateDisplayName: (input: {
    datasourceId: number;
    schema: string;
    relation: string;
    column?: string;
    displayName: string | null;
  }) => request<void>('/schema/display-name', { method: 'PUT', body: input }),
};

export const tokensApi = {
  list: () => request<{ tokens: UserToken[] }>('/tokens').then((r) => r.tokens),
  issue: (userId: number, expiresInDays?: number) =>
    request<IssuedToken>(`/users/${userId}/tokens`, { method: 'POST', body: { expiresInDays } }),
  revoke: (tokenId: number) => request<void>(`/tokens/${tokenId}`, { method: 'DELETE' }),
};

export const usersApi = {
  list: () => request<{ users: User[] }>('/users').then((r) => r.users),
  create: (input: { username: string; displayName: string }) => request<User>('/users', { method: 'POST', body: input }),
};
