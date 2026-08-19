// MSW 핸들러 — server API 구현 전까지 admin 화면 개발/검증용.
// 경로·응답 형태는 API 계약서 v1.4 와 일치. 쓰기는 모듈 메모리에만 반영(새로고침 시 시드로 복원).
import { http, HttpResponse } from 'msw';
import type { Datasource } from '@/lib/api/types';
import { charts, chartDetail, datasources as seedDatasources, datasourceUsage, embedKeys as seedEmbedKeys, schemaTables, users as seedUsers } from './seed';
import type { AdminUserSummary, AuthUser, EmbedKeySummary, User } from '@/lib/api';
import { assembleOption, buildAggregateRows, buildGeneratedSql, buildRawRows, buildRowsSql, buildTablePreview, withResultDisplayNames } from './mockTransform';
import type { BuilderConfig, ChartMainTable, ChartType, TableRef } from '@/lib/api';
import { builderExecutionIssue } from '@/lib/builder';

// 쓰기 가능한 가변 상태(세션 한정)
let datasources: Datasource[] = seedDatasources.map((d) => ({ ...d }));
let nextDsId = Math.max(...datasources.map((d) => d.id)) + 1;
let chartList = charts.map((c) => ({ ...c }));
let nextChartId = Math.max(...charts.map((c) => c.id)) + 1;
const savedCharts: Record<number, Record<string, unknown>> = {}; // 생성/수정된 차트 전체 본문
const computedAtByChart: Record<number, string> = {};
let userList: User[] = seedUsers.map((u) => ({ ...u }));
type MockEmbedKey = EmbedKeySummary & { embedKey: string };
let embedKeyList: MockEmbedKey[] = seedEmbedKeys.map((k) => ({ ...k }));
let nextUserId = Math.max(...userList.map((u) => u.id)) + 1;
let nextEmbedKeyId = Math.max(...embedKeyList.map((k) => k.id)) + 1;
let mockAuthenticated = true;
const mockUser: AuthUser = {
  id: userList[0]?.id ?? 1,
  username: userList[0]?.username ?? 'admin',
  displayName: userList[0]?.displayName ?? '관리자',
  role: 'admin',
};

/** 시드·저장 차트의 ownerId 로 소유자를 찾는다. 소유자 정보가 없으면 로그인 사용자 소유로 본다. */
function matchesOwner(chartId: number, q: string): boolean {
  const owner = chartOwner(chartId);
  return owner.username.toLowerCase().includes(q) || owner.displayName.toLowerCase().includes(q) || String(owner.id) === q;
}

function chartOwner(chartId: number): User {
  const ownerId = chartList.find((chart) => chart.id === chartId)?.ownerId;
  return userList.find((user) => user.id === ownerId) ?? userList[0];
}

let adminUserList: AdminUserSummary[] = userList.map((user, index) => ({
  ...user,
  displayName: user.displayName || null,
  role: index === 0 ? 'admin' : 'member',
  active: true,
  createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  chartCount: chartList.filter((chart) => chartOwner(chart.id).id === user.id).length,
  embeddedChartCount: new Set(embedKeyList
    .filter((key) => key.userId === user.id && key.status === 'ACTIVE')
    .map((key) => key.chartId)).size,
  activeSessions: index === 0 ? 1 : 0,
}));

function isMockAuthenticated() {
  if (typeof document === 'undefined') return mockAuthenticated;
  const persisted = document.cookie.split('; ').find((entry) => entry.startsWith('chartsdk-msw-auth='))?.split('=')[1];
  return persisted == null ? mockAuthenticated : persisted === '1';
}

function setMockAuthenticated(value: boolean) {
  mockAuthenticated = value;
  if (typeof document !== 'undefined') {
    document.cookie = `chartsdk-msw-auth=${value ? '1' : '0'}; Path=/; SameSite=Lax`;
  }
}

function publicEmbedKey(key: MockEmbedKey): EmbedKeySummary {
  return {
    id: key.id,
    chartId: key.chartId,
    userId: key.userId,
    expiresAt: key.expiresAt,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
    revokedReason: key.revokedReason,
  };
}

const err = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status });

function chartUsesDatasource(chartId: number, primaryDatasourceId: number, datasourceId: number): boolean {
  if (primaryDatasourceId === datasourceId) return true;
  const saved = savedCharts[chartId] as { builderConfig?: BuilderConfig } | undefined;
  return saved?.builderConfig?.joins?.some((join) => join.table.datasourceId === datasourceId) ?? false;
}

function chartUsesRelation(
  chart: (typeof charts)[number],
  datasourceId: number | null,
  schema: string,
  relation: string | null,
): boolean {
  const saved = savedCharts[chart.id] as { builderConfig?: BuilderConfig } | undefined;
  const refs: TableRef[] = [];
  if (chart.mainTable) refs.push(chart.mainTable);
  if (saved?.builderConfig?.joins) refs.push(...saved.builderConfig.joins.map((join) => join.table));
  return refs.some((ref) => (datasourceId == null || ref.datasourceId === datasourceId)
    && (ref.schema || 'public') === schema
    && (relation == null || ref.name === relation));
}

function mainTableResponse(value: unknown, fallbackDatasourceId: number): ChartMainTable | null {
  if (!value || typeof value !== 'object') return null;
  const table = value as Partial<TableRef>;
  if (!table.name) return null;
  const datasourceId = Number(table.datasourceId) || fallbackDatasourceId;
  const datasourceName = datasources.find((item) => item.id === datasourceId)?.name;
  if (!datasourceName) return null;
  return {
    datasourceId,
    datasourceName,
    schema: table.schema || 'public',
    name: table.name,
    ...(table.handle ? { handle: table.handle } : {}),
  };
}

function computedAtFor(chartId: number): string {
  return computedAtByChart[chartId] ?? '2026-07-27T00:00:00.000Z';
}

// 저장 차트 서빙은 서버(5-인자 convert)처럼 refresh_mode 컬럼값을 assembleOption에 명시적으로 넘긴다.
function storedRefreshMode(chart: { refreshMode?: unknown }): string | null {
  return typeof chart.refreshMode === 'string' ? chart.refreshMode : null;
}

export const handlers = [
  // ── 로그인/세션 ───────────────────────────────────
  http.get('/api/v1/auth/csrf', () => HttpResponse.json({ headerName: 'X-CSRF-TOKEN', token: 'msw-csrf-token' })),
  http.get('/api/v1/auth/me', () => (isMockAuthenticated()
    ? HttpResponse.json(mockUser)
    : err(401, 'AUTH_REQUIRED', '로그인이 필요합니다.'))),
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    if (!body.username || !body.password) return err(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
    setMockAuthenticated(true);
    return HttpResponse.json(mockUser);
  }),
  http.post('/api/v1/auth/signup', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string; passwordConfirm?: string };
    if (!body.password || [...body.password].length < 8) {
      return err(400, 'PASSWORD_TOO_SHORT', '비밀번호는 최소 8자여야 합니다.', { fields: { password: '최소 8자여야 합니다.' } });
    }
    if (body.password !== body.passwordConfirm) {
      return err(400, 'PASSWORD_CONFIRMATION_MISMATCH', '비밀번호 확인이 일치하지 않습니다.', { fields: { passwordConfirm: '비밀번호와 같아야 합니다.' } });
    }
    const username = body.username?.trim() ?? '';
    if (!username) return err(400, 'VALIDATION_FAILED', '아이디를 입력하세요.', { fields: { username: '아이디를 입력하세요.' } });
    const id = nextUserId++;
    userList = [...userList, { id, username, displayName: username }];
    adminUserList = [...adminUserList, {
      id, username, displayName: username, role: 'member', active: true,
      createdAt: new Date().toISOString(), chartCount: 0, embeddedChartCount: 0, activeSessions: 0,
    }];
    return HttpResponse.json({ id, username, displayName: username, role: 'member' }, { status: 201 });
  }),
  http.post('/api/v1/auth/logout', () => {
    setMockAuthenticated(false);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── 차트 ──────────────────────────────────────────
  http.get('/api/v1/charts', ({ request }) => {
    const p = new URL(request.url).searchParams;
    const q = p.get('q')?.toLowerCase().trim();
    const type = p.get('type');
    const dsId = p.get('datasourceId');
    const schema = p.get('schema');
    const relation = p.get('relation');
    const sort = p.get('sort') ?? 'updated_desc';
    const pageSize = Math.min(60, Math.max(1, Number(p.get('pageSize') ?? '8') || 8));
    const requestedPage = Math.max(1, Number(p.get('page') ?? '1') || 1);
    let list = chartList;
    // 서버 미러: 검색어는 차트 이름·설명과 소유자의 아이디·표시 이름·숫자 id 에 걸린다(역할 무관).
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.description?.toLowerCase().includes(q) ?? false)
      || matchesOwner(c.id, q));
    if (type) list = list.filter((c) => c.chartType === type);
    if (dsId) list = list.filter((c) => chartUsesDatasource(c.id, c.datasourceId, Number(dsId)));
    if (schema || relation) {
      list = list.filter((c) => chartUsesRelation(c, dsId ? Number(dsId) : null, schema || 'public', relation));
    }
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'updated_asc': return a.updatedAt.localeCompare(b.updatedAt);
        case 'name_asc': return a.name.localeCompare(b.name, 'ko');
        case 'name_desc': return b.name.localeCompare(a.name, 'ko');
        default: return b.updatedAt.localeCompare(a.updatedAt); // updated_desc
      }
    });
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;
    return HttpResponse.json({ charts: list.slice(start, start + pageSize), page, pageSize, total, totalPages });
  }),
  http.get('/api/v1/charts/previews', ({ request }) => {
    const ids = (new URL(request.url).searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id));
    const previews: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const id of ids) {
      const saved = savedCharts[id] as
        | { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown>; refreshMode?: unknown }
        | undefined;
      const summary = chartList.find((c) => c.id === id);
      const chart = saved ?? (summary ? chartDetail(summary) : null);
      if (!chart?.builderConfig || !chart.chartType) {
        errors[String(id)] = 'Preview unavailable.';
        continue;
      }
      const result = withResultDisplayNames(buildAggregateRows(chart.builderConfig, chart.chartType), chart.builderConfig);
      previews[String(id)] = {
        chartId: id,
        rowCount: result.rowCount,
        truncated: result.truncated,
        ...(result.sampling ? { sampling: result.sampling, approximate: result.sampling.approximate, sampleRate: result.sampleRate } : {}),
        computedAt: computedAtFor(id),
        option: assembleOption(result, chart.chartType, chart.options ?? {}, chart.builderConfig, storedRefreshMode(chart)),
      };
    }
    return HttpResponse.json({ previews, errors });
  }),
  // 외부 페이지에 붙여 넣은 실제 sdk.js 선언형 스캔까지 E2E로 검증하기 위한 임베드 API 미러.
  // 동적 /charts/:id 보다 먼저 선언해야 "data"가 차트 id로 오인되지 않는다.
  // 서버 계약과 동일하게 chartId 파라미터는 받지 않는다 — 서빙 차트는 임베드 키의 바인딩에서만 나온다.
  http.get('/api/v1/charts/data', ({ request }) => {
    const authorization = request.headers.get('Authorization');
    const keyValue = authorization?.match(/^Bearer\s+(.+)$/)?.[1];
    const key = embedKeyList.find((item) => item.embedKey === keyValue && item.status === 'ACTIVE' && new Date(item.expiresAt).getTime() > Date.now());
    if (!key) return err(401, 'TOKEN_INVALID', '유효하지 않은 임베드 키입니다.');

    const chartId = key.chartId;
    const saved = savedCharts[chartId] as
      | { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown>; refreshMode?: unknown }
      | undefined;
    const summary = chartList.find((chart) => chart.id === chartId);
    const chart = saved ?? (summary ? chartDetail(summary) : null);
    if (!chart?.builderConfig || !chart.chartType) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');

    const result = withResultDisplayNames(buildAggregateRows(chart.builderConfig, chart.chartType), chart.builderConfig);
    return HttpResponse.json({
      chartId,
      rowCount: result.rowCount,
      truncated: result.truncated,
      ...(result.sampling ? { sampling: result.sampling, approximate: result.sampling.approximate, sampleRate: result.sampleRate } : {}),
      computedAt: computedAtFor(chartId),
      option: assembleOption(result, chart.chartType, chart.options ?? {}, chart.builderConfig, storedRefreshMode(chart)),
    });
  }),
  http.get('/api/v1/charts/:id/preview', ({ params }) => {
    const id = Number(params.id);
    const saved = savedCharts[id] as
      | { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown>; refreshMode?: unknown }
      | undefined;
    const summary = chartList.find((c) => c.id === id);
    const chart = saved ?? (summary ? chartDetail(summary) : null);
    if (!chart?.builderConfig || !chart.chartType) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    const result = withResultDisplayNames(buildAggregateRows(chart.builderConfig, chart.chartType), chart.builderConfig);
    return HttpResponse.json({
      chartId: id,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      elapsedMs: result.elapsedMs,
      ...(result.sampling ? { sampling: result.sampling, approximate: result.sampling.approximate, sampleRate: result.sampleRate } : {}),
      computedAt: computedAtFor(id),
      option: assembleOption(result, chart.chartType, chart.options ?? {}, chart.builderConfig, storedRefreshMode(chart)),
    });
  }),
  http.post('/api/v1/charts/:id/refresh', ({ params }) => {
    const id = Number(params.id);
    const saved = savedCharts[id] as
      | { builderConfig?: BuilderConfig; chartType?: ChartType }
      | undefined;
    const summary = chartList.find((chart) => chart.id === id);
    const chart = saved ?? (summary ? chartDetail(summary) : null);
    if (!chart?.builderConfig || !chart.chartType) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    const result = withResultDisplayNames(buildAggregateRows(chart.builderConfig, chart.chartType), chart.builderConfig);
    const computedAt = new Date().toISOString();
    computedAtByChart[id] = computedAt;
    return HttpResponse.json({
      chartId: id,
      computedAt,
      rowCount: result.rowCount,
      elapsedMs: result.elapsedMs,
      ...(result.sampling ? {
        sampling: result.sampling,
        approximate: result.sampling.approximate,
        sampleRate: result.sampleRate,
      } : {}),
    });
  }),
  http.get('/api/v1/charts/:id', ({ params }) => {
    const id = Number(params.id);
    if (savedCharts[id]) return HttpResponse.json(savedCharts[id]);
    const summary = chartList.find((c) => c.id === id);
    return summary ? HttpResponse.json(chartDetail(summary)) : err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
  }),
  http.delete('/api/v1/charts/:id', ({ params }) => {
    chartList = chartList.filter((c) => c.id !== Number(params.id));
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/charts/:id/duplicate', ({ params }) => {
    const sourceId = Number(params.id);
    const sourceSummary = chartList.find((chart) => chart.id === sourceId);
    if (!sourceSummary) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');

    const source = savedCharts[sourceId] ?? chartDetail(sourceSummary);
    const id = nextChartId++;
    const now = new Date().toISOString();
    const name = `${String(source.name).slice(0, 195)} (복사)`;
    const copy = {
      ...source,
      id,
      version: 0,
      name,
      createdAt: now,
      updatedAt: now,
    };
    savedCharts[id] = copy;
    computedAtByChart[id] = computedAtFor(sourceId);
    chartList = [{ ...sourceSummary, id, name, updatedAt: now }, ...chartList];
    return HttpResponse.json(copy, { status: 201 });
  }),

  // 저장(생성/수정) — 서버는 1회 실행해 캐시 시드(PRD 7.3). 목은 입력 에코 + id 부여.
  http.post('/api/v1/charts', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = '2026-06-22T00:00:00Z';
    const id = nextChartId++;
    const builderConfig = body.builderConfig as Partial<BuilderConfig> | undefined;
    const datasourceId = Number(body.datasourceId) || 1;
    const mainTable = mainTableResponse(builderConfig?.table, datasourceId);
    if (!mainTable) return err(400, 'MAIN_TABLE_REQUIRED', 'A primary table is required to save a chart.');
    const chart = { id, ...body, version: 0, mainTable, createdAt: now, updatedAt: now };
    savedCharts[id] = chart;
    computedAtByChart[id] = now;
    chartList = [{
      id,
      name: String(body.name ?? ''),
      description: (body.description as string) ?? null,
      chartType: body.chartType as ChartType,
      datasourceId,
      mainTable,
      ownerId: mockUser.id,
      authorName: seedUsers[0]?.displayName ?? null,
      updatedAt: now,
    }, ...chartList];
    return HttpResponse.json(chart, { status: 201 });
  }),
  http.put('/api/v1/charts/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const now = '2026-06-22T00:00:00Z';
    const prev = savedCharts[id] as { createdAt?: string; version?: number } | undefined;
    const builderConfig = body.builderConfig as Partial<BuilderConfig> | undefined;
    const current = chartList.find((item) => item.id === id);
    const datasourceId = Number(body.datasourceId) || current?.datasourceId || 1;
    const mainTable = mainTableResponse(builderConfig?.table, datasourceId) ?? current?.mainTable;
    if (!mainTable) return err(400, 'MAIN_TABLE_REQUIRED', 'A primary table is required to save a chart.');
    const version = (prev?.version ?? (Number(body.version) || 0)) + 1;
    const chart = { id, ...body, version, mainTable, createdAt: prev?.createdAt ?? now, updatedAt: now };
    savedCharts[id] = chart;
    computedAtByChart[id] = now;
    chartList = chartList.map((c) => (c.id === id ? {
      ...c,
      name: String(body.name ?? c.name),
      description: (body.description as string) ?? null,
      chartType: (body.chartType as ChartType) ?? c.chartType,
      datasourceId,
      mainTable,
      updatedAt: now,
    } : c));
    return HttpResponse.json(chart);
  }),

  // ── 데이터소스 ────────────────────────────────────
  http.get('/api/v1/datasources', () => HttpResponse.json({ datasources })),

  http.post('/api/v1/datasources', async ({ request }) => {
    const body = (await request.json()) as Partial<Datasource>;
    if (body.name?.trim().toLocaleLowerCase('en-US') === 'new') {
      return err(400, 'DATASOURCE_NAME_RESERVED', "Datasource name 'new' is reserved.");
    }
    const created: Datasource = {
      id: nextDsId++,
      name: body.name ?? '',
      host: body.host ?? '',
      port: body.port ?? 5432,
      databaseName: body.databaseName ?? '',
      dbUser: body.dbUser ?? '',
      maxPoolSize: body.maxPoolSize ?? 5,
      lastTestedAt: null,
      lastTestOk: null,
    };
    datasources = [...datasources, created];
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put('/api/v1/datasources/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Partial<Datasource>;
    const idx = datasources.findIndex((d) => d.id === id);
    if (idx < 0) return err(404, 'NOT_FOUND', '데이터소스를 찾을 수 없습니다.');
    if (body.name?.trim().toLocaleLowerCase('en-US') === 'new') {
      return err(400, 'DATASOURCE_NAME_RESERVED', "Datasource name 'new' is reserved.");
    }
    datasources[idx] = { ...datasources[idx], ...body, id };
    const nextName = datasources[idx].name;
    chartList = chartList.map((chart) => ({
      ...chart,
      ...(chart.mainTable?.datasourceId === id
        ? { mainTable: { ...chart.mainTable, datasourceName: nextName } }
        : {}),
    }));
    for (const [chartId, saved] of Object.entries(savedCharts)) {
      const mainTable = saved.mainTable as ChartMainTable | null | undefined;
      if (mainTable?.datasourceId === id) {
        savedCharts[Number(chartId)] = { ...saved, mainTable: { ...mainTable, datasourceName: nextName } };
      }
    }
    return HttpResponse.json(datasources[idx]);
  }),

  http.delete('/api/v1/datasources/:id', ({ params }) => {
    const id = Number(params.id);
    const inUse = datasourceUsage[id] ?? 0;
    if (inUse > 0) return err(409, 'DATASOURCE_IN_USE', `이 데이터소스를 사용하는 차트 ${inUse}개가 있습니다.`, { chartCount: inUse });
    datasources = datasources.filter((d) => d.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/api/v1/datasources/test', async () => HttpResponse.json({ ok: true, message: '연결 성공 (89ms)' })),

  // ── 스키마 탐색(S2) ───────────────────────────────
  http.get('/api/v1/schema/tables', ({ request }) => {
    const dsId = Number(new URL(request.url).searchParams.get('datasourceId'));
    return HttpResponse.json({ tables: schemaTables.filter((t) => t.datasourceId === dsId) });
  }),

  http.put('/api/v1/schema/display-name', async ({ request }) => {
    const body = (await request.json()) as {
      datasourceId: number;
      schema?: string;
      relation: string;
      column?: string;
      displayName?: string | null;
    };
    const table = schemaTables.find((item) =>
      item.datasourceId === Number(body.datasourceId)
      && item.schema === (body.schema || 'public')
      && item.name === body.relation);
    if (!table) return err(400, 'INVALID_IDENTIFIER', '관계를 찾을 수 없습니다.');
    const displayName = body.displayName?.trim() || undefined;
    if (body.column) {
      const column = table.columns.find((item) => item.name === body.column);
      if (!column) return err(400, 'INVALID_IDENTIFIER', '컬럼을 찾을 수 없습니다.');
      column.displayName = displayName;
    } else {
      table.displayName = displayName;
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/schema/tables/:name/preview', ({ params, request }) => {
    const url = new URL(request.url);
    const schema = url.searchParams.get('schema') ?? 'public';
    const dsId = Number(url.searchParams.get('datasourceId'));
    const table = schemaTables.find((t) => t.name === params.name && t.schema === schema && t.datasourceId === dsId);
    return table ? HttpResponse.json(buildTablePreview(table)) : err(404, 'NOT_FOUND', '테이블을 찾을 수 없습니다.');
  }),

  // ── 노코드 실행/미리보기(S2) — 목 변환기 ───────────
  http.post('/api/v1/query/run-builder', async ({ request }) => {
    const body = (await request.json()) as { builderConfig: BuilderConfig; chartType: ChartType; options: Record<string, unknown>; mode?: 'aggregate' | 'rows' };
    const validationIssue = body.mode === 'rows'
      ? null
      : builderExecutionIssue(body.builderConfig, body.chartType, schemaTables);
    if (validationIssue) return err(400, 'INVALID_BUILDER_CONFIG', validationIssue);
    if (body.mode === 'rows') {
      return HttpResponse.json({ ...buildRawRows(body.builderConfig), generatedSql: buildRowsSql(body.builderConfig) });
    }
    const result = withResultDisplayNames(buildAggregateRows(body.builderConfig, body.chartType), body.builderConfig);
    const option = assembleOption(result, body.chartType, body.options, body.builderConfig);
    return HttpResponse.json({ ...result, generatedSql: buildGeneratedSql(body.builderConfig, body.chartType), option });
  }),

  http.post('/api/v1/charts/preview', async ({ request }) => {
    const body = (await request.json()) as {
      chartType: ChartType;
      options: Record<string, unknown>;
      builderConfig?: BuilderConfig;
      rows: { columns: { name: string; type: string }[]; rows: unknown[][] };
    };
    const result = { ...body.rows, rowCount: body.rows.rows.length, truncated: false, elapsedMs: 0 };
    return HttpResponse.json({
      option: assembleOption(result, body.chartType, body.options, body.builderConfig ?? null),
    });
  }),

  // ── 임베드 키(S3) ─────────────────────────────
  http.get('/api/v1/charts/:chartId/embed-keys', ({ params }) => {
    const chartId = Number(params.chartId);
    if (!chartList.some((c) => c.id === chartId) && !savedCharts[chartId]) {
      return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    }
    const now = Date.now();
    return HttpResponse.json({
      embedKeys: embedKeyList
        .filter((key) => key.chartId === chartId && key.userId === mockUser.id)
        .map((key) => ({
          ...publicEmbedKey(key),
          status: key.status === 'REVOKED' || new Date(key.expiresAt).getTime() > now ? key.status : 'EXPIRED',
        })),
    });
  }),

  // 발급 — 로그인 사용자/차트 쌍당 활성 1개. 요청 본문에서 userId를 받지 않는다.
  http.post('/api/v1/charts/:chartId/embed-keys', async ({ params, request }) => {
    const chartId = Number(params.chartId);
    const body = (await request.json().catch(() => ({}))) as { expiresInDays?: number };
    const userId = mockUser.id;
    if (!chartList.some((c) => c.id === chartId) && !savedCharts[chartId]) {
      return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    }
    const days = body.expiresInDays ?? 365;
    embedKeyList = embedKeyList.map((k) => (
      k.chartId === chartId && k.userId === userId && k.status === 'ACTIVE'
        ? { ...k, status: 'REVOKED', revokedAt: new Date().toISOString(), revokedReason: 'ROTATED' }
        : k
    ));
    const now = new Date();
    const id = nextEmbedKeyId++;
    const key: MockEmbedKey = {
      id,
      chartId,
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
      status: 'ACTIVE',
      embedKey: `cek1_${id}_msw${String(id).padStart(8, '0')}`,
    };
    embedKeyList = [...embedKeyList, key];
    return HttpResponse.json(key);
  }),

  // 회수
  http.delete('/api/v1/embed-keys/:keyId', ({ params }) => {
    const id = Number(params.keyId);
    const active = embedKeyList.find((key) => key.id === id && key.status === 'ACTIVE');
    if (!active) return err(404, 'EMBED_KEY_NOT_FOUND', '임베드 키를 찾을 수 없습니다.');
    embedKeyList = embedKeyList.map((key) => key.id === id
      ? { ...key, status: 'REVOKED', revokedAt: new Date().toISOString(), revokedReason: 'MANUAL' }
      : key);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── 관리자 사용자 ─────────────────────────────────
  http.get('/api/v1/admin/users', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.toLowerCase();
    const status = params.get('status');
    const role = params.get('role');
    const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize') ?? 20)));
    const requestedPage = Math.max(1, Number(params.get('page') ?? 1));
    let list = [...adminUserList];
    if (q) list = list.filter((user) => user.username.toLowerCase().includes(q)
      || user.displayName?.toLowerCase().includes(q));
    if (status) list = list.filter((user) => user.active === (status === 'active'));
    if (role) list = list.filter((user) => user.role === role);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    return HttpResponse.json({ users: list.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, totalPages });
  }),
  http.get('/api/v1/admin/users/:userId', ({ params }) => adminUserDetail(Number(params.userId))),
  http.patch('/api/v1/admin/users/:userId/status', async ({ params, request }) => {
    const userId = Number(params.userId);
    const body = await request.json() as { active: boolean };
    const user = adminUserList.find((item) => item.id === userId);
    if (!user) return err(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    if (!body.active && userId === mockUser.id) return err(409, 'CANNOT_DISABLE_SELF', '현재 로그인한 관리자 계정은 비활성화할 수 없습니다.');
    adminUserList = adminUserList.map((item) => item.id === userId ? { ...item, active: body.active, activeSessions: 0 } : item);
    if (!body.active) embedKeyList = embedKeyList.map((key) => key.userId === userId && key.status === 'ACTIVE'
      ? { ...key, status: 'REVOKED', revokedAt: new Date().toISOString(), revokedReason: 'USER_DISABLED' }
      : key);
    return adminUserDetail(userId);
  }),
  http.patch('/api/v1/admin/users/:userId/role', async ({ params, request }) => {
    const userId = Number(params.userId);
    const body = await request.json() as { role: 'member' | 'admin' };
    const user = adminUserList.find((item) => item.id === userId);
    if (!user) return err(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    const activeAdminCount = adminUserList.filter((item) => item.active && item.role === 'admin').length;
    if (user.active && user.role === 'admin' && body.role === 'member' && activeAdminCount <= 1) {
      return err(409, 'LAST_ADMIN_PROTECTED', '마지막 활성 관리자는 변경할 수 없습니다.');
    }
    adminUserList = adminUserList.map((item) => item.id === userId ? { ...item, role: body.role, activeSessions: 0 } : item);
    return adminUserDetail(userId);
  }),

  // ── 관리자 전체 차트(읽기 전용) ──────────────────
  http.get('/api/v1/admin/charts/:chartId/preview', ({ params }) => {
    const id = Number(params.chartId);
    const chart = storedChart(id);
    // 서버 미러: 관리자 미리보기는 저장 스냅샷 전용이라 live 차트(스냅샷 없음)는 고객 DB 조회 없이 404 다.
    if (chart && storedRefreshMode(chart) === 'live') {
      return err(404, 'SNAPSHOT_NOT_FOUND', '저장된 미리보기 스냅샷이 없습니다. 관리자 화면은 고객 데이터베이스를 조회하지 않습니다.');
    }
    return chartPreview(id);
  }),
  http.get('/api/v1/admin/charts/:chartId', ({ params }) => {
    const id = Number(params.chartId);
    const summary = chartList.find((chart) => chart.id === id);
    if (!summary) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    const detail = savedCharts[id] ?? chartDetail(summary);
    const owner = chartOwner(id);
    return HttpResponse.json({ ...detail, ...adminChartSummary(summary), ownerId: owner.id, ownerUsername: owner.username,
      ownerDisplayName: owner.displayName, datasourceName: datasources.find((item) => item.id === summary.datasourceId)?.name ?? null });
  }),
];

function adminUserDetail(userId: number) {
  const user = adminUserList.find((item) => item.id === userId);
  if (!user) return err(404, 'USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
  const keys = embedKeyList.filter((key) => key.userId === userId);
  return HttpResponse.json({
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, active: user.active, createdAt: user.createdAt },
    summary: {
      activeSessions: user.activeSessions,
      chartCount: user.chartCount,
      embeddedChartCount: user.embeddedChartCount,
      activeEmbedKeyCount: keys.filter((key) => key.status === 'ACTIVE').length,
      expiredEmbedKeyCount: keys.filter((key) => key.status === 'EXPIRED').length,
      revokedEmbedKeyCount: keys.filter((key) => key.status === 'REVOKED').length,
      lastEmbedKeyIssuedAt: keys[0]?.createdAt ?? null,
    },
    embedKeys: keys.map((key) => ({ ...publicEmbedKey(key), chartName: chartList.find((chart) => chart.id === key.chartId)?.name ?? `#${key.chartId}` })),
  });
}

function adminChartSummary(chart: (typeof chartList)[number]) {
  const owner = chartOwner(chart.id);
  return { ...chart, ownerId: owner.id, ownerUsername: owner.username, ownerDisplayName: owner.displayName,
    refreshMode: storedRefreshMode(savedCharts[chart.id] ?? chartDetail(chart)) ?? 'manual', createdAt: '2026-01-01T00:00:00Z' };
}

/** 저장본이 있으면 저장본, 없으면 시드 상세 — 미리보기·관리자 미리보기가 같은 정의를 본다. */
function storedChart(id: number) {
  const saved = savedCharts[id] as { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown>; refreshMode?: unknown } | undefined;
  const summary = chartList.find((chart) => chart.id === id);
  return saved ?? (summary ? chartDetail(summary) : null);
}

function chartPreview(id: number) {
  const chart = storedChart(id);
  if (!chart?.builderConfig || !chart.chartType) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
  const result = withResultDisplayNames(buildAggregateRows(chart.builderConfig, chart.chartType), chart.builderConfig);
  return HttpResponse.json({ chartId: id, columns: result.columns, rows: result.rows, rowCount: result.rowCount,
    truncated: result.truncated, elapsedMs: result.elapsedMs, computedAt: computedAtFor(id),
    option: assembleOption(result, chart.chartType, chart.options ?? {}, chart.builderConfig, storedRefreshMode(chart)) });
}
