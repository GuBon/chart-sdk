// MSW 핸들러 — server API 구현 전까지 admin 화면 개발/검증용.
// 경로·응답 형태는 API 계약서 v1.4 와 일치. 쓰기는 모듈 메모리에만 반영(새로고침 시 시드로 복원).
import { http, HttpResponse } from 'msw';
import type { Datasource } from '@/lib/api/types';
import { charts, chartDetail, datasources as seedDatasources, datasourceUsage, schemaTables, tokens as seedTokens, users as seedUsers } from './seed';
import type { User, UserToken } from '@/lib/api';
import { assembleOption, buildAggregateRows, buildGeneratedSql, buildRawRows, buildTablePreview } from './mockTransform';
import type { BuilderConfig, ChartType } from '@/lib/api';
import { builderValidationIssue } from '@/lib/builder';

// 쓰기 가능한 가변 상태(세션 한정)
let datasources: Datasource[] = seedDatasources.map((d) => ({ ...d }));
let nextDsId = Math.max(...datasources.map((d) => d.id)) + 1;
let chartList = charts.map((c) => ({ ...c }));
let nextChartId = Math.max(...charts.map((c) => c.id)) + 1;
const savedCharts: Record<number, Record<string, unknown>> = {}; // 생성/수정된 차트 전체 본문
let tokenList: UserToken[] = seedTokens.map((t) => ({ ...t }));
let userList: User[] = seedUsers.map((u) => ({ ...u }));
let nextTokenId = Math.max(...tokenList.map((t) => t.tokenId)) + 1;
let nextUserId = Math.max(...userList.map((u) => u.id)) + 1;

const err = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  HttpResponse.json({ error: { code, message, ...extra } }, { status });

export const handlers = [
  // ── 차트 ──────────────────────────────────────────
  http.get('/api/v1/charts', ({ request }) => {
    const p = new URL(request.url).searchParams;
    const q = p.get('q')?.toLowerCase().trim();
    const type = p.get('type');
    const dsId = p.get('datasourceId');
    const sort = p.get('sort') ?? 'updated_desc';
    const pageSize = Math.min(60, Math.max(1, Number(p.get('pageSize') ?? '12') || 12));
    const requestedPage = Math.max(1, Number(p.get('page') ?? '1') || 1);
    let list = chartList;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.description?.toLowerCase().includes(q) ?? false));
    if (type) list = list.filter((c) => c.chartType === type);
    if (dsId) list = list.filter((c) => c.datasourceId === Number(dsId));
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
        | { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown> }
        | undefined;
      const summary = chartList.find((c) => c.id === id);
      const chart = saved ?? (summary ? chartDetail(summary) : null);
      if (!chart?.builderConfig || !chart.chartType) {
        errors[String(id)] = 'Preview unavailable.';
        continue;
      }
      const result = buildAggregateRows(chart.builderConfig);
      previews[String(id)] = {
        chartId: id,
        rowCount: result.rowCount,
        truncated: result.truncated,
        computedAt: new Date().toISOString(),
        option: assembleOption(result, chart.chartType, chart.options ?? {}),
      };
    }
    return HttpResponse.json({ previews, errors });
  }),
  http.get('/api/v1/charts/:id/preview', ({ params }) => {
    const id = Number(params.id);
    const saved = savedCharts[id] as
      | { builderConfig?: BuilderConfig; chartType?: ChartType; options?: Record<string, unknown> }
      | undefined;
    const summary = chartList.find((c) => c.id === id);
    const chart = saved ?? (summary ? chartDetail(summary) : null);
    if (!chart?.builderConfig || !chart.chartType) return err(404, 'CHART_NOT_FOUND', '차트를 찾을 수 없습니다.');
    const result = buildAggregateRows(chart.builderConfig);
    return HttpResponse.json({
      chartId: id,
      rowCount: result.rowCount,
      truncated: result.truncated,
      computedAt: new Date().toISOString(),
      option: assembleOption(result, chart.chartType, chart.options ?? {}),
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

  // 저장(생성/수정) — 서버는 1회 실행해 캐시 시드(PRD 7.3). 목은 입력 에코 + id 부여.
  http.post('/api/v1/charts', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const now = '2026-06-22T00:00:00Z';
    const id = nextChartId++;
    const chart = { id, ...body, createdAt: now, updatedAt: now };
    savedCharts[id] = chart;
    chartList = [{ id, name: String(body.name ?? ''), description: (body.description as string) ?? null, chartType: body.chartType as never, datasourceId: Number(body.datasourceId) || 1, updatedAt: now }, ...chartList];
    return HttpResponse.json(chart, { status: 201 });
  }),
  http.put('/api/v1/charts/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as Record<string, unknown>;
    const now = '2026-06-22T00:00:00Z';
    const prev = savedCharts[id] as { createdAt?: string } | undefined;
    const chart = { id, ...body, createdAt: prev?.createdAt ?? now, updatedAt: now };
    savedCharts[id] = chart;
    chartList = chartList.map((c) => (c.id === id ? { ...c, name: String(body.name ?? c.name), description: (body.description as string) ?? null, chartType: (body.chartType as never) ?? c.chartType, datasourceId: Number(body.datasourceId) || c.datasourceId, updatedAt: now } : c));
    return HttpResponse.json(chart);
  }),

  // ── 데이터소스 ────────────────────────────────────
  http.get('/api/v1/datasources', () => HttpResponse.json({ datasources })),

  http.post('/api/v1/datasources', async ({ request }) => {
    const body = (await request.json()) as Partial<Datasource>;
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
    datasources[idx] = { ...datasources[idx], ...body, id };
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
  http.get('/api/v1/schema/tables', () => HttpResponse.json({ tables: schemaTables })),

  http.get('/api/v1/schema/tables/:name/preview', ({ params }) => {
    const table = schemaTables.find((t) => t.name === params.name);
    return table ? HttpResponse.json(buildTablePreview(table)) : err(404, 'NOT_FOUND', '테이블을 찾을 수 없습니다.');
  }),

  // ── 노코드 실행/미리보기(S2) — 목 변환기 ───────────
  http.post('/api/v1/query/run-builder', async ({ request }) => {
    const body = (await request.json()) as { builderConfig: BuilderConfig; chartType: ChartType; options: Record<string, unknown>; mode?: 'aggregate' | 'rows' };
    const validationIssue = builderValidationIssue(body.builderConfig, body.chartType, schemaTables);
    if (validationIssue) return err(400, 'INVALID_BUILDER_CONFIG', validationIssue);
    if (body.mode === 'rows') return HttpResponse.json(buildRawRows(body.builderConfig));
    const result = buildAggregateRows(body.builderConfig);
    const option = assembleOption(result, body.chartType, body.options);
    return HttpResponse.json({ ...result, generatedSql: buildGeneratedSql(body.builderConfig), option });
  }),

  http.post('/api/v1/charts/preview', async ({ request }) => {
    const body = (await request.json()) as { chartType: ChartType; options: Record<string, unknown>; rows: { columns: { name: string; type: string }[]; rows: unknown[][] } };
    const result = { ...body.rows, rowCount: body.rows.rows.length, truncated: false, elapsedMs: 0 };
    return HttpResponse.json({ option: assembleOption(result, body.chartType, body.options) });
  }),

  // ── 토큰 · 사용자(S7) ─────────────────────────────
  http.get('/api/v1/tokens', () => HttpResponse.json({ tokens: tokenList })),

  // 발급 — 1인 1활성: 기존 활성 회수 후 새 토큰 INSERT(API 4.1)
  http.post('/api/v1/users/:userId/tokens', async ({ params, request }) => {
    const userId = Number(params.userId);
    const body = (await request.json().catch(() => ({}))) as { expiresInDays?: number };
    const days = body.expiresInDays ?? 365;
    tokenList = tokenList.map((t) => (t.userId === userId && t.isActive ? { ...t, isActive: false } : t));
    const now = new Date();
    const exp = new Date(now.getTime() + days * 86400000);
    const token: UserToken & { token: string } = {
      tokenId: nextTokenId++,
      userId,
      createdAt: now.toISOString(),
      expiresAt: exp.toISOString(),
      isActive: true,
      token: `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ userId }))}.${Math.random().toString(36).slice(2, 6)}`,
    };
    tokenList = [...tokenList, token];
    return HttpResponse.json({ tokenId: token.tokenId, token: token.token, userId, expiresAt: token.expiresAt, isActive: true }, { status: 201 });
  }),

  // 회수
  http.delete('/api/v1/tokens/:tokenId', ({ params }) => {
    const id = Number(params.tokenId);
    tokenList = tokenList.map((t) => (t.tokenId === id ? { ...t, isActive: false } : t));
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/api/v1/users', () => HttpResponse.json({ users: userList })),
  http.post('/api/v1/users', async ({ request }) => {
    const body = (await request.json()) as { username: string; displayName: string };
    const user: User = { id: nextUserId++, username: body.username, displayName: body.displayName };
    userList = [...userList, user];
    return HttpResponse.json(user, { status: 201 });
  }),
];
