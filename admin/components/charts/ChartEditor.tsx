'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { defaultsFor, type MajorType, type Options } from '@chartsdk/chart-options';
import { ApiError, chartsApi, datasourcesApi, queryApi, schemaApi } from '@/lib/api';
import type { BuilderConfig, ChartInput, Datasource, QueryResult, RefreshMode, SchemaTable } from '@/lib/api';
import { emptyBuilder } from '@/lib/builder';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SchemaExplorer } from './SchemaExplorer';
import { NocodeBuilder } from './NocodeBuilder';
import { ResultsPanel, type ResultTab } from './ResultsPanel';
import { ChartPreview } from './ChartPreview';
import { OptionPanel } from './OptionPanel';
import { EmbedModal } from './EmbedModal';

// optionRegistry storage='column' 키 (chartType 은 별도 state). 저장 시 options JSONB 에서 분리.
const COLUMN_OPTION_KEYS = ['description', 'refreshMode', 'cacheTtlSeconds'] as const;
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
  const [runError, setRunError] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('result');

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDatasource, setPendingDatasource] = useState<number | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [pendingRun, setPendingRun] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(chartId ?? null);
  const [embedOpen, setEmbedOpen] = useState(false);

  useEffect(() => {
    void datasourcesApi.list().then(setDatasources);
  }, []);

  useEffect(() => {
    if (datasourceId == null) {
      setTables([]);
      return;
    }
    void schemaApi.tables(datasourceId).then(setTables);
  }, [datasourceId]);

  // 기존 차트 진입 → 상태 복원 + 1회 자동 실행(화면설계 4.1)
  useEffect(() => {
    if (chartId == null) return;
    void chartsApi.get(chartId).then((c) => {
      setName(c.name);
      setDatasourceId(c.datasourceId);
      setBuilder(c.builderConfig);
      setChartType(c.chartType);
      setOptions({ ...defaultsFor(c.chartType), ...c.options });
      setPendingRun(true);
    });
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

  const resetResults = () => {
    setResult(null);
    setRaw(null);
    setOption(null);
    setGeneratedSql(null);
    setRunError(null);
  };

  const applyDatasource = (id: number) => {
    setDatasourceId(id);
    setBuilder(emptyBuilder());
    resetResults();
    setDirty(true);
  };

  // 구성이 있으면 소스변경확인 모달, 없으면 즉시 변경(화면설계 4.1)
  const changeDatasource = (id: number) => {
    if (builder.table) setPendingDatasource(id);
    else applyDatasource(id);
  };

  const selectTable = async (table: string) => {
    setBuilder({ table, xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null });
    resetResults();
    setDirty(true);
    if (datasourceId == null) return;
    setRaw(await schemaApi.preview(table, datasourceId));
    setResultTab('raw');
  };

  const runBuilder = async () => {
    if (!builder.table || !builder.xAxis || builder.yAxis.length === 0 || datasourceId == null) return;
    setRunning(true);
    setRunError(null);
    try {
      // 집계(실행 결과) + 조건 적용 원본(원본 데이터, mode:rows) 동시 갱신 — 화면설계 4.2
      const [res, rawRes] = await Promise.all([
        queryApi.runBuilder({ datasourceId, builderConfig: builder, chartType, options, mode: 'aggregate' }),
        queryApi.runBuilder({ datasourceId, builderConfig: builder, chartType, options, mode: 'rows' }),
      ]);
      setResult(res);
      setRaw(rawRes);
      setGeneratedSql(res.generatedSql ?? null);
      setOption(res.option ?? null);
      setResultTab('result');
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : '실행에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  };

  // 자동 실행(기존 차트 로드 후)
  useEffect(() => {
    if (pendingRun && builder.table && datasourceId != null) {
      setPendingRun(false);
      void runBuilder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRun, builder, datasourceId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // 저장 = 실행 + 캐시 시드(PRD 7.3). 현재 구성으로 실행 성공한 결과가 있어야 저장 가능
  // (빌더 변경 시 result/generatedSql 가 무효화되므로 stale SQL 저장이 방지된다).
  const canSave = !!name.trim() && !!builder.table && !!builder.xAxis && builder.yAxis.length > 0 && !!result;

  const save = async (): Promise<boolean> => {
    if (!canSave || datasourceId == null) return false;
    setSaving(true);
    try {
      const { jsonb, cols } = splitOptions(options);
      const input: ChartInput = {
        name: name.trim(),
        description: (cols.description as string) || null,
        datasourceId,
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
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-border bg-bg-panel">
          <SchemaExplorer
            datasources={datasources}
            tables={tables}
            datasourceId={datasourceId}
            selectedTable={builder.table}
            onChangeDatasource={changeDatasource}
            onSelectTable={selectTable}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NocodeBuilder
              config={builder}
              tables={tables}
              onChange={(b) => {
                // 데이터 구성 변경 → 기존 실행 결과/SQL/option 무효화(stale 저장 방지). 재실행 필요.
                setBuilder(b);
                setDirty(true);
                setResult(null);
                setGeneratedSql(null);
                setOption(null);
                setRunError(null);
              }}
              onRun={runBuilder}
              running={running}
              generatedSql={generatedSql}
              sqlOpen={sqlOpen}
              onToggleSql={() => setSqlOpen((v) => !v)}
            />
          </div>
          <div className="h-72 shrink-0 border-t border-border">
            <ResultsPanel result={result} raw={raw} tab={resultTab} onTab={setResultTab} running={running} error={runError} />
          </div>
        </section>

        <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-l border-border bg-bg-panel">
          <div className="shrink-0 border-b border-border p-4">
            <p className="mb-3 text-sm font-medium text-text-primary">차트 미리보기</p>
            <div className="h-48">
              {option ? (
                <ChartPreview option={option} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-md bg-muted/40 text-xs text-text-tertiary">
                  실행하면 미리보기가 표시됩니다.
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
              setChartType(to);
              setOptions(next);
              setDirty(true);
            }}
            onChangeOptions={(next) => {
              setOptions(next);
              setDirty(true);
            }}
          />
        </aside>
      </div>

      {/* 소스변경확인 모달 */}
      {pendingDatasource != null && (
        <Modal
          title="데이터소스를 변경할까요?"
          width={440}
          divided={false}
          onClose={() => setPendingDatasource(null)}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={() => setPendingDatasource(null)}>
                취소
              </Button>
              <Button size="sm" className="h-[34px]" onClick={() => { applyDatasource(pendingDatasource); setPendingDatasource(null); }}>
                변경
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-text-secondary">데이터소스를 바꾸면 현재 구성(테이블·축·조건)이 초기화됩니다. 기존 구성은 이전 DB 스키마를 가리키므로 유지할 수 없습니다.</p>
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
          chart={{ id: savedId, name: name || '차트', description: (options.description as string) || null, chartType, updatedAt: new Date().toISOString() }}
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
