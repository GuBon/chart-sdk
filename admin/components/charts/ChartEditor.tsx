'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { defaultsFor, type MajorType, type Options } from '@chartsdk/chart-options';
import { ApiError, chartsApi, datasourcesApi, queryApi, schemaApi } from '@/lib/api';
import type { BuilderConfig, ChartDataResponse, ChartInput, Datasource, QueryResult, RefreshMode, SchemaTable } from '@/lib/api';
import { builderValidationIssue, emptyBuilder, migrateBuilderConfig, normalizeBuilder, normalizeBuilderForChartType, tableRefKey } from '@/lib/builder';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ResizeHandle, useResizable } from '@/components/ui/Resizable';
import { SchemaExplorer } from './SchemaExplorer';
import { NocodeBuilder } from './NocodeBuilder';
import { ResultsPanel, type ResultTab } from './ResultsPanel';
import { ChartPreview } from './ChartPreview';
import { OptionPanel } from './OptionPanel';
import { EmbedModal } from './EmbedModal';

// optionRegistry storage='column' 키 (chartType 은 별도 state). 저장 시 options JSONB 에서 분리.
const COLUMN_OPTION_KEYS = ['description', 'refreshMode', 'cacheTtlSeconds'] as const;
const LEFT_PANEL_DEFAULT_WIDTH = 320;
const RIGHT_PANEL_DEFAULT_WIDTH = 440;

function splitOptions(o: Options): { jsonb: Options; cols: Record<string, unknown> } {
  const jsonb: Options = { ...o };
  const cols: Record<string, unknown> = {};
  for (const k of COLUMN_OPTION_KEYS) {
    if (k in jsonb) {
      cols[k] = jsonb[k];
      delete jsonb[k];
    }
  }
  return { jsonb, cols };
}

/** 단건 저장 미리보기의 캐시 rows를 편집기 실행 결과 상태로 복원한다. 구 서버 응답은 option만 사용한다. */
function queryResultFromPreview(preview: ChartDataResponse): QueryResult | null {
  if (!preview.columns || !preview.rows || typeof preview.elapsedMs !== 'number') return null;
  return {
    columns: preview.columns,
    rows: preview.rows,
    rowCount: preview.rowCount ?? preview.rows.length,
    truncated: preview.truncated ?? false,
    elapsedMs: preview.elapsedMs,
    option: preview.option,
    ...(preview.sampling ? { sampling: preview.sampling } : {}),
    ...(preview.approximate !== undefined ? { approximate: preview.approximate } : {}),
    ...(preview.sampleRate !== undefined ? { sampleRate: preview.sampleRate } : {}),
  };
}

// S2 차트 편집 셸 — 좌(스키마)·중(빌더+결과)·우(미리보기+옵션)의 상태 허브. (S2-a~f)
export function ChartEditor({ chartId }: { chartId?: number }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [datasourceId, setDatasourceId] = useState<number | null>(null);
  const [builder, setBuilder] = useState<BuilderConfig>(emptyBuilder());
  const [chartType, setChartType] = useState<MajorType>('bar');
  const [options, setOptions] = useState<Options>(() => defaultsFor('bar'));

  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [sqlOpen, setSqlOpen] = useState(false);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [raw, setRaw] = useState<QueryResult | null>(null);
  const [option, setOption] = useState<Record<string, unknown> | null>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [rawRunning, setRawRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [initialPreviewLoading, setInitialPreviewLoading] = useState(chartId != null);
  const [initialPreviewError, setInitialPreviewError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('result');
  const rawRequestId = useRef(0);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingBaseTable, setPendingBaseTable] = useState<SchemaTable | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(chartId ?? null);
  const [embedOpen, setEmbedOpen] = useState(false);

  useEffect(() => {
    void datasourcesApi.list().then(setDatasources).catch(() => setToast('데이터소스를 불러오지 못했습니다. 백엔드 연결을 확인하세요.'));
  }, []);

  // 다중 소스 조인 지원 — 모든 데이터소스의 테이블을 하나의 풀로 로드(각 datasourceId 태깅).
  useEffect(() => {
    if (datasources.length === 0) {
      setTables([]);
      return;
    }
    let cancelled = false;
    void Promise.all(datasources.map((d) => schemaApi.tables(d.id).catch(() => [])))
      .then((lists) => { if (!cancelled) setTables(lists.flat()); });
    return () => { cancelled = true; };
  }, [datasources]);

  // 기존 차트 진입 → 정의와 마지막 저장 캐시를 함께 복원한다. 고객 DB 쿼리를 자동 재실행하지 않는다.
  // 레거시 문자열 테이블 참조는 TableRef 로 승격한다.
  useEffect(() => {
    if (chartId == null) return;
    let cancelled = false;
    setInitialPreviewLoading(true);
    setInitialPreviewError(null);
    setResult(null);
    setOption(null);
    setGeneratedSql(null);

    void Promise.allSettled([chartsApi.get(chartId), chartsApi.preview(chartId)] as const)
      .then(([definitionResult, previewResult]) => {
        if (cancelled) return;
        if (definitionResult.status === 'fulfilled') {
          const c = definitionResult.value;
          setName(c.name);
          setDatasourceId(c.datasourceId);
          setBuilder(migrateBuilderConfig(normalizeBuilder(c.builderConfig), c.datasourceId));
          setChartType(c.chartType);
          setOptions({ ...defaultsFor(c.chartType), ...c.options });
          setGeneratedSql(c.sqlQuery || null);
        } else {
          setToast('차트를 불러오지 못했습니다.');
        }

        if (previewResult.status === 'fulfilled') {
          const cachedResult = queryResultFromPreview(previewResult.value);
          setOption(previewResult.value.option);
          if (cachedResult) setResult(cachedResult);
          setResultTab('result');
        } else {
          setInitialPreviewError('저장된 미리보기를 불러오지 못했습니다. [실행]하면 다시 계산합니다.');
        }
      })
      .finally(() => { if (!cancelled) setInitialPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [chartId]);

  // 옵션/대분류 변경 → SQL 재실행 없이 option 재조립(2B preview). 디바운스.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      void queryApi
        .preview({ chartType, options, rows: { columns: result.columns, rows: result.rows } })
        .then((r) => setOption(r.option))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [chartType, options, result]);

  // S2 3분할 패널 크기 — 사용자가 경계를 드래그해 조절
  const leftPanel = useResizable(LEFT_PANEL_DEFAULT_WIDTH, 200, 480, 'left');
  const rightPanel = useResizable(RIGHT_PANEL_DEFAULT_WIDTH, 280, 560, 'right');
  const resultsPanel = useResizable(288, 120, 560, 'up');

  const invalidateRaw = () => {
    rawRequestId.current += 1;
    setRaw(null);
    setRawRunning(false);
    setRawError(null);
  };

  const resetResults = () => {
    setResult(null);
    invalidateRaw();
    setOption(null);
    setGeneratedSql(null);
    setRunError(null);
    setInitialPreviewLoading(false);
    setInitialPreviewError(null);
  };

  // 사이드바 데이터소스 = 탐색 컨텍스트. 소스 변경은 드롭다운 필터만 바꾸고 구성은 보존(비파괴).
  const changeDatasource = (id: number) => setDatasourceId(id);

  // 실행·저장에 쓰는 primary 데이터소스는 base 테이블에서 파생(사이드바 탐색 소스와 무관).
  const primaryDatasourceId = builder.table?.datasourceId ?? datasourceId;

  const previewBaseTable = async (t: SchemaTable) => {
    const requestId = ++rawRequestId.current;
    setRawRunning(true);
    setRawError(null);
    try {
      const preview = await schemaApi.preview(t.schema, t.name, t.datasourceId);
      if (requestId !== rawRequestId.current) return;
      setRaw(preview);
      setResultTab('raw');
    } catch (e) {
      if (requestId !== rawRequestId.current) return;
      setRaw(null);
      setRawError(e instanceof ApiError ? e.message : '원본 데이터를 불러오지 못했습니다.');
    } finally {
      if (requestId === rawRequestId.current) setRawRunning(false);
    }
  };

  // 기준 테이블 확정(구성 초기화 + 원본 미리보기). 확인 절차는 selectTable 이 담당.
  const applyBaseTable = async (t: SchemaTable) => {
    // 표본 설정은 방식(자동/갯수)·seed 로 테이블 독립이므로 그대로 유지(정확도는 절대 갯수가 결정).
    setBuilder({ table: { datasourceId: t.datasourceId, schema: t.schema, name: t.name }, joins: [], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: builder.sample ?? null });
    resetResults();
    setDirty(true);
    // 원본 미리보기는 부가 기능 — 실패해도 테이블 선택은 유지(미처리 rejection·크래시 방지).
    await previewBaseTable(t);
  };

  // 사이드바 트리 클릭. base 가 이미 있고 다른 테이블이면 초기화 경고 모달, 없거나 같은 테이블이면 즉시.
  const selectTable = async (t: SchemaTable) => {
    if (builder.table && tableRefKey(builder.table) === tableRefKey(t)) {
      // 같은 base 재클릭 → 미리보기만(실패 무시)
      await previewBaseTable(t);
      return;
    }
    if (builder.table) {
      setPendingBaseTable(t); // 다른 테이블 → 확인 모달(구성 초기화 경고)
      return;
    }
    await applyBaseTable(t);
  };

  const runBuilder = async () => {
    const issue = builderValidationIssue(builder, chartType, tables);
    if (issue || primaryDatasourceId == null) {
      if (issue) setRunError(issue);
      return;
    }
    setRunning(true);
    setRunError(null);
    setInitialPreviewLoading(false);
    setInitialPreviewError(null);
    setResultTab('result');
    invalidateRaw();
    try {
      // 실행 버튼은 집계만 수행한다. 조인 원본 조회는 [원본 데이터] 탭을 열 때 지연 실행해 중복 조인을 피한다.
      const res = await queryApi.runBuilder({ datasourceId: primaryDatasourceId, builderConfig: builder, chartType, options, mode: 'aggregate' });
      setResult(res);
      setGeneratedSql(res.generatedSql ?? null);
      setOption(res.option ?? null);
      setResultTab('result');
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : '실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  };

  const loadRaw = async () => {
    if (!builder.table || primaryDatasourceId == null) return;
    const requestId = ++rawRequestId.current;
    setRawRunning(true);
    setRawError(null);
    try {
      const rawResult = await queryApi.runBuilder({
        datasourceId: primaryDatasourceId,
        builderConfig: builder,
        chartType,
        options,
        mode: 'rows',
      });
      if (requestId === rawRequestId.current) setRaw(rawResult);
    } catch (e) {
      if (requestId === rawRequestId.current) {
        setRawError(e instanceof ApiError ? e.message : '원본 데이터 조회에 실패했습니다.');
      }
    } finally {
      if (requestId === rawRequestId.current) setRawRunning(false);
    }
  };

  const changeResultTab = (tab: ResultTab) => {
    setResultTab(tab);
    if (tab === 'raw' && raw == null && !rawRunning) void loadRaw();
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 저장 = 실행 + 캐시 시드(PRD 7.3). 현재 구성으로 실행 성공한 결과가 있어야 저장 가능
  // (빌더 변경 시 result/generatedSql 가 무효화되므로 stale SQL 저장이 방지된다).
  const canSave = !!name.trim() && !builderValidationIssue(builder, chartType, tables) && !!result;

  const save = async (): Promise<boolean> => {
    if (!canSave || primaryDatasourceId == null) return false;
    setSaving(true);
    try {
      const { jsonb, cols } = splitOptions(options);
      const input: ChartInput = {
        name: name.trim(),
        description: (cols.description as string) || null,
        datasourceId: primaryDatasourceId,
        defineMode: 'builder',
        sqlQuery: generatedSql ?? '',
        builderConfig: builder,
        chartType,
        options: jsonb,
        refreshMode: (cols.refreshMode as RefreshMode) ?? 'ttl',
        cacheTtlSeconds: Number(cols.cacheTtlSeconds ?? 3600),
      };
      if (savedId == null) {
        const created = await chartsApi.create(input);
        setSavedId(created.id); // 이후 저장은 update — 중복 생성 방지, 임베드 버튼 활성화
      } else {
        await chartsApi.update(savedId, input);
      }
      setDirty(false);
      setToast('저장되었습니다');
      return true;
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : '저장에 실패했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goList = () => {
    if (dirty) setLeaveOpen(true);
    else router.push('/');
  };

  return (
    <>
      {/* Top Bar — 편집 헤더 */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-bg-panel px-4">
        <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} onClick={goList}>
          목록
        </Button>
        <div className="w-[280px]">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            placeholder="차트 이름"
          />
        </div>
        {savedId != null && <span className="text-[13px] text-text-tertiary">#{savedId}</span>}
        <div className="flex-1" />
        <Button variant="secondary" size="sm" className="h-8" disabled={!canSave || saving} onClick={save}>
          {saving ? '저장 중…' : '저장'}
        </Button>
        <Button size="sm" className="h-8" disabled={savedId == null} onClick={() => setEmbedOpen(true)}>
          임베드 코드
        </Button>
      </header>

      {/* 정의 모드 탭 */}
      <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-bg-panel px-4">
        <span className="flex h-full items-center border-b-2 border-primary px-2 text-sm font-medium text-text-primary">노코드</span>
        <span className="flex h-full items-center gap-1.5 px-2 text-sm text-text-tertiary">
          SQL
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary">준비 중</span>
        </span>
      </nav>

      {/* 3분할 Body */}
      <div className="flex flex-1 overflow-hidden">
        <aside style={{ width: leftPanel.size }} className="shrink-0 overflow-y-auto border-r border-border bg-bg-panel">
          <SchemaExplorer
            datasources={datasources}
            tables={tables.filter((t) => t.datasourceId === datasourceId)}
            datasourceId={datasourceId}
            selectedTable={builder.table ? tableRefKey(builder.table) : null}
            onChangeDatasource={changeDatasource}
            onSelectTable={selectTable}
          />
        </aside>
        <ResizeHandle dir="left" onPointerDown={leftPanel.onPointerDown} />

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NocodeBuilder
              config={builder}
              chartType={chartType}
              tables={tables}
              browseDatasourceId={datasourceId}
              datasources={datasources}
              onChange={(b) => {
                // 데이터 구성 변경 → 기존 실행 결과/SQL/option 무효화(stale 저장 방지). 재실행 필요.
                setBuilder(normalizeBuilderForChartType(b, chartType));
                setDirty(true);
                setResult(null);
                invalidateRaw();
                setGeneratedSql(null);
                setOption(null);
                setRunError(null);
                setInitialPreviewLoading(false);
                setInitialPreviewError(null);
              }}
              onRun={runBuilder}
              running={running}
              generatedSql={generatedSql}
              sqlOpen={sqlOpen}
              onToggleSql={() => setSqlOpen((v) => !v)}
            />
          </div>
          <ResizeHandle dir="up" onPointerDown={resultsPanel.onPointerDown} />
          <div style={{ height: resultsPanel.size }} className="shrink-0 border-t border-border">
            <ResultsPanel
              result={result}
              raw={raw}
              tab={resultTab}
              onTab={changeResultTab}
              running={resultTab === 'raw' ? rawRunning : running}
              error={resultTab === 'raw' ? rawError : runError}
            />
          </div>
        </section>

        <ResizeHandle dir="right" onPointerDown={rightPanel.onPointerDown} />
        <aside style={{ width: rightPanel.size }} className="flex shrink-0 flex-col overflow-y-auto border-l border-border bg-bg-panel">
          <div className="shrink-0 border-b border-border p-4">
            <p className="mb-3 text-sm font-medium text-text-primary">차트 미리보기</p>
            <div className="h-48">
              {option ? (
                <ChartPreview option={option} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-md bg-muted/40 text-xs text-text-tertiary">
                  {initialPreviewLoading
                    ? '저장된 미리보기를 불러오는 중…'
                    : initialPreviewError ?? '실행하면 미리보기가 표시됩니다.'}
                </div>
              )}
            </div>
          </div>
          <OptionPanel
            chartType={chartType}
            options={options}
            columns={result?.columns ?? []}
            hasResult={!!result}
            onChangeChartType={(to, next) => {
              // 데이터 구성은 비파괴 전환(PRD 4.1). 분포 전환(집계 none·버킷 해제)·원형 전환(시리즈 1개)처럼
              // 구성이 실제로 바뀔 때만 기존 실행 결과가 stale → 무효화. 동일 구조(막대↔선↔원형) 전환은 미리보기 유지.
              const normalized = normalizeBuilderForChartType(builder, to);
              const builderChanged = JSON.stringify(normalized) !== JSON.stringify(builder);
              setChartType(to);
              setOptions(next);
              setBuilder(normalized);
              if (builderChanged) resetResults();
              else if (!result) setOption(null);
              setDirty(true);
            }}
            onChangeOptions={(next) => {
              setOptions(next);
              if (!result) setOption(null);
              setDirty(true);
            }}
          />
        </aside>
      </div>

      {/* 기준 테이블 변경 확인 모달 (사이드바 트리 클릭 시) */}
      {pendingBaseTable != null && (
        <Modal
          title="기준 테이블을 바꿀까요?"
          width={460}
          divided={false}
          onClose={() => setPendingBaseTable(null)}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={() => setPendingBaseTable(null)}>
                취소
              </Button>
              <Button size="sm" className="h-[34px]" onClick={() => { const t = pendingBaseTable; setPendingBaseTable(null); if (t) void applyBaseTable(t); }}>
                변경
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-text-secondary">기준 테이블을 바꾸면 현재 구성(조인·축·조건)이 초기화됩니다. 다른 데이터소스의 테이블과 조인하려면 사이드바에서 소스만 바꾼 뒤 우측 &quot;조인&quot; 행에서 추가하세요.</p>
        </Modal>
      )}

      {/* 이탈확인 모달 */}
      {leaveOpen && (
        <Modal
          title="저장되지 않은 변경이 있습니다"
          width={460}
          divided={false}
          onClose={() => setLeaveOpen(false)}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={() => setLeaveOpen(false)}>
                계속 편집
              </Button>
              <Button variant="ghost" size="sm" className="h-[34px]" onClick={() => router.push('/')}>
                저장 안 함
              </Button>
              <Button size="sm" className="h-[34px]" disabled={!canSave || saving} onClick={async () => { if (await save()) router.push('/'); }}>
                저장 후 나가기
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-text-secondary">이대로 나가면 변경 내용이 사라집니다.</p>
        </Modal>
      )}

      {/* 임베드 코드 모달(S3) — 저장된 차트에서만 */}
      {embedOpen && savedId != null && (
        <EmbedModal
          chart={{ id: savedId, name: name || '차트', description: (options.description as string) || null, chartType, datasourceId: primaryDatasourceId ?? 0, updatedAt: new Date().toISOString() }}
          onClose={() => setEmbedOpen(false)}
        />
      )}

      {/* 저장 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
