'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronUp, ChevronsRight } from 'lucide-react';
import { defaultsFor, type MajorType, type Options } from '@chartsdk/chart-options';
import { normalizeMapViewport, type MapViewport, type MapViewportMode } from '@chartsdk/chart-options/geo';
import { ApiError, chartsApi, datasourcesApi, queryApi, schemaApi } from '@/lib/api';
import type { BuilderConfig, ChartDataResponse, ChartInput, Datasource, QueryResult, RefreshMode, SchemaTable, TableRef } from '@/lib/api';
import { activeTables, builderValidationIssue, emptyBuilder, emptyJoin, migrateBuilderConfig, normalizeBuilder, normalizeBuilderForChartType, tableRefKey, withUniqueHandle } from '@/lib/builder';
import { chartEditPath } from '@/lib/chartRoutes';
import {
  createMapViewportSession,
  isCompleteMapViewport,
  mapViewportEquals,
  mapViewportSessionReducer,
  pendingMapViewport,
} from '@/lib/mapViewportSession';
import { tableSelectionLabel, type TableSelectionTarget } from '@/lib/tableSelection';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ResizeHandle, useResizable } from '@/components/ui/Resizable';
import { SchemaExplorer } from './SchemaExplorer';
import { NocodeBuilder } from './NocodeBuilder';
import { ResultsPanel, type ResultTab } from './ResultsPanel';
import { ChartPreviewPanel } from './ChartPreviewPanel';
import { OptionPanel, type OptionDock, type OptionDockPreference } from './OptionPanel';
import { EmbedModal } from './EmbedModal';

// optionRegistry storage='column' 키 (chartType 은 별도 state). 저장 시 options JSONB 에서 분리.
const COLUMN_OPTION_KEYS = ['description', 'refreshMode', 'cacheTtlSeconds'] as const;
const LEFT_PANEL_DEFAULT_WIDTH = 320;
const RIGHT_PANEL_DEFAULT_WIDTH = 440;
const PANEL_COLLAPSE_THRESHOLD = 48;
const PANEL_RESTORE_MIN_WIDTH = 200;
const OPTION_DOCK_RIGHT_AT = 840;
const OPTION_DOCK_BOTTOM_AT = 760;
const OPTION_DOCK_MANUAL_MIN_WIDTH = 640;

function useStoredBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored === 'true' || stored === 'false') setValue(stored === 'true');
    setRestored(true);
  }, [key]);
  useEffect(() => {
    if (restored) window.localStorage.setItem(key, String(value));
  }, [key, restored, value]);
  return [value, setValue] as const;
}

function useStoredOptionDockPreference(key: string) {
  const [value, setValue] = useState<OptionDockPreference>('auto');
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored === 'auto' || stored === 'right' || stored === 'bottom') setValue(stored);
    setRestored(true);
  }, [key]);
  useEffect(() => {
    if (restored) window.localStorage.setItem(key, value);
  }, [key, restored, value]);
  return [value, setValue, restored] as const;
}

function CollapsedPanelRail({
  label,
  controls,
  testId,
  onExpand,
}: {
  label: string;
  controls: string;
  testId: string;
  onExpand: () => void;
}) {
  return (
    <div className="flex w-10 shrink-0 border-r border-border bg-bg-panel">
      <button
        type="button"
        data-testid={testId}
        onClick={onExpand}
        aria-label={`${label} 펼치기`}
        aria-controls={controls}
        aria-expanded={false}
        title={`${label} 펼치기`}
        className="group flex w-full flex-col items-center gap-2.5 py-3 text-text-secondary hover:bg-muted hover:text-text-primary"
      >
        <ChevronsRight className="size-3.5 shrink-0" />
        <span className="text-[11px] font-medium tracking-[0.08em] [writing-mode:vertical-rl]">{label}</span>
      </button>
    </div>
  );
}

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

function optionsWithMapViewport(
  options: Options,
  chartType: MajorType,
  viewport: MapViewport,
): Options {
  if (chartType !== 'map' && chartType !== 'geoscatter') return options;
  const next = structuredClone(options);
  next.map = { ...(next.map ?? {}), viewport: structuredClone(viewport) };
  return next;
}

/** 정식 편집 URL만 교체한다. 같은 ChartEditor를 다시 마운트하지 않아 로드 직후 사용자 변경을 덮어쓰지 않는다. */
function replaceEditorPath(path: string) {
  if (window.location.pathname !== path) window.history.replaceState(window.history.state, '', path);
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
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const builderWorkspaceRef = useRef<HTMLElement>(null);
  const visualWorkspaceRef = useRef<HTMLElement>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingBaseTable, setPendingBaseTable] = useState<SchemaTable | null>(null);
  const [tableSelectionTarget, setTableSelectionTarget] = useState<TableSelectionTarget | null>(null);
  const [tableSelectionFocusKey, setTableSelectionFocusKey] = useState(0);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(chartId ?? null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useStoredBoolean('chartsdk.editor.leftCollapsed', false);
  const [builderCollapsed, setBuilderCollapsed] = useStoredBoolean('chartsdk.editor.builderCollapsed', false);
  const [optionEditorCollapsed, setOptionEditorCollapsed] = useStoredBoolean('chartsdk.editor.optionEditorCollapsed', false);
  const [optionDockPreference, setOptionDockPreference, optionDockPreferenceRestored] = useStoredOptionDockPreference('chartsdk.editor.optionDock');
  const [autoOptionDock, setAutoOptionDock] = useState<OptionDock>('bottom');
  const [mapViewportSession, dispatchMapViewport] = useReducer(
    mapViewportSessionReducer,
    undefined,
    () => createMapViewportSession(defaultsFor('bar').map?.viewport),
  );

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
    setTableSelectionTarget(null);
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
          const restoredBuilder = migrateBuilderConfig(normalizeBuilder(c.builderConfig), c.datasourceId);
          setBuilder(restoredBuilder);
          setChartType(c.chartType);
          const restoredOptions = { ...defaultsFor(c.chartType), ...c.options };
          setOptions(restoredOptions);
          dispatchMapViewport({
            type: 'restoreGlobal',
            viewport: normalizeMapViewport(restoredOptions.map?.viewport),
          });
          setGeneratedSql(c.sqlQuery || null);
          const canonicalPath = chartEditPath(c.id, c.mainTable);
          replaceEditorPath(canonicalPath);
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
  const leftPanel = useResizable(LEFT_PANEL_DEFAULT_WIDTH, 200, 480, 'left', 'chartsdk.editor.leftWidth', {
    shouldCollapse: (nextSize) => nextSize <= PANEL_COLLAPSE_THRESHOLD,
    onCollapse: () => setLeftCollapsed(true),
  });
  const rightPanel = useResizable(RIGHT_PANEL_DEFAULT_WIDTH, 280, null, 'right', 'chartsdk.editor.rightWidth', {
    shouldCollapse: (_nextSize, event) => {
      const bounds = builderWorkspaceRef.current?.getBoundingClientRect();
      return bounds != null && event.clientX <= bounds.left + PANEL_COLLAPSE_THRESHOLD;
    },
    onCollapse: () => setBuilderCollapsed(true),
  });
  const resultsPanel = useResizable(288, 120, 560, 'up', 'chartsdk.editor.resultsHeight');
  const optionEditor = useResizable(280, 120, 720, 'up', 'chartsdk.editor.optionHeight');
  const optionEditorWidth = useResizable(400, 320, 520, 'right', 'chartsdk.editor.optionWidth');
  const rightPanelSize = rightPanel.size;
  const setRightPanelSize = rightPanel.setSize;

  useEffect(() => {
    const workspace = visualWorkspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setAutoOptionDock((current) => {
        if (width >= OPTION_DOCK_RIGHT_AT) return 'right';
        if (width <= OPTION_DOCK_BOTTOM_AT) return 'bottom';
        return current;
      });
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  // 오른쪽 고정을 복원하거나 선택했을 때 미리보기가 찌그러지지 않도록 우측 작업영역을 먼저 확보한다.
  useEffect(() => {
    if (!optionDockPreferenceRestored || optionDockPreference !== 'right' || builderCollapsed) return;
    if (rightPanelSize >= OPTION_DOCK_BOTTOM_AT) return;
    const editorWidth = editorBodyRef.current?.clientWidth;
    if (editorWidth == null) return;
    const leftWidth = leftCollapsed ? 40 : leftPanel.size;
    const availableWidth = editorWidth - leftWidth - PANEL_RESTORE_MIN_WIDTH;
    if (availableWidth >= OPTION_DOCK_MANUAL_MIN_WIDTH) {
      setRightPanelSize(Math.min(OPTION_DOCK_RIGHT_AT, availableWidth));
    } else {
      setBuilderCollapsed(true);
    }
  }, [
    builderCollapsed,
    leftCollapsed,
    leftPanel.size,
    optionDockPreference,
    optionDockPreferenceRestored,
    rightPanelSize,
    setRightPanelSize,
    setBuilderCollapsed,
  ]);

  const actualOptionDock: OptionDock = optionDockPreference === 'auto' ? autoOptionDock : optionDockPreference;

  useEffect(() => {
    if (builderCollapsed) return;
    const workspace = builderWorkspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= PANEL_COLLAPSE_THRESHOLD) setBuilderCollapsed(true);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [builderCollapsed, setBuilderCollapsed]);

  const expandBuilderPanel = () => {
    const editorWidth = editorBodyRef.current?.clientWidth;
    if (editorWidth != null) {
      const leftWidth = leftCollapsed ? 40 : leftPanel.size;
      const availableRightWidth = Math.max(280, editorWidth - leftWidth - PANEL_RESTORE_MIN_WIDTH);
      if (rightPanel.size > availableRightWidth) rightPanel.setSize(availableRightWidth);
    }
    setBuilderCollapsed(false);
  };

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
    dispatchMapViewport({ type: 'setEditing', editing: false });
  };

  // 사이드바 데이터소스 = 탐색 컨텍스트. 소스 변경은 드롭다운 필터만 바꾸고 구성은 보존(비파괴).
  const changeDatasource = (id: number) => setDatasourceId(id);

  const requestTableSelection = (target: TableSelectionTarget) => {
    setPendingBaseTable(null);
    setTableSelectionTarget(target);

    const currentRef = target.kind === 'base'
      ? builder.table
      : target.kind === 'join'
        ? builder.joins?.[target.index]?.table
        : null;
    if (currentRef) setDatasourceId(currentRef.datasourceId);

    setLeftCollapsed(false);
    setTableSelectionFocusKey((key) => key + 1);
  };

  const cancelTableSelection = () => {
    setPendingBaseTable(null);
    setTableSelectionTarget(null);
  };

  useEffect(() => {
    if (!tableSelectionTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelTableSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tableSelectionTarget]);

  const applyBuilderChange = (next: BuilderConfig) => {
    setBuilder(normalizeBuilderForChartType(next, chartType));
    setTableSelectionTarget(null);
    setDirty(true);
    resetResults();
  };

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
    setBuilder({ table: { datasourceId: t.datasourceId, schema: t.schema, name: t.name }, joins: [], xAxis: null, xAxisBucket: null, seriesBy: null, seriesOrder: 'asc', yAxis: [], where: [], orderBy: null, sample: builder.sample ?? null, geoPoint: undefined, geoArea: undefined });
    setTableSelectionTarget(null);
    resetResults();
    setDirty(true);
    // 원본 미리보기는 부가 기능 — 실패해도 테이블 선택은 유지(미처리 rejection·크래시 방지).
    await previewBaseTable(t);
  };

  // 왼쪽 목록의 선택 결과를 현재 선택 대상(base/기존 조인/새 조인)에 적용한다.
  const selectTable = async (t: SchemaTable) => {
    if (!tableSelectionTarget) return;

    const refOf = (table: SchemaTable): TableRef => ({ datasourceId: table.datasourceId, schema: table.schema, name: table.name });
    if (tableSelectionTarget.kind === 'base') {
      if (builder.table && tableRefKey(builder.table) === tableRefKey(t)) {
        setTableSelectionTarget(null);
        await previewBaseTable(t);
        return;
      }
      if (builder.table) {
        setPendingBaseTable(t);
        return;
      }
      await applyBaseTable(t);
      return;
    }

    if (!builder.table) return;
    const joins = builder.joins ?? [];
    if (tableSelectionTarget.kind === 'newJoin') {
      const table = withUniqueHandle(refOf(t), activeTables(builder));
      applyBuilderChange({ ...builder, joins: [...joins, emptyJoin(table)] });
      return;
    }

    const index = tableSelectionTarget.index;
    const others = [builder.table, ...joins.filter((_, joinIndex) => joinIndex !== index).map((join) => join.table)];
    const table = withUniqueHandle(refOf(t), others);
    applyBuilderChange({
      ...builder,
      joins: joins.map((join, joinIndex) =>
        joinIndex === index ? { ...join, table, on: { leftColumn: '', rightColumn: '' } } : join,
      ),
    });
  };

  const selectionLabel = tableSelectionTarget
    ? tableSelectionLabel(tableSelectionTarget, builder.joins?.length ?? 0)
    : null;
  const selectedTableKey = tableSelectionTarget?.kind === 'join'
    ? builder.joins?.[tableSelectionTarget.index]?.table
      ? tableRefKey(builder.joins[tableSelectionTarget.index].table)
      : null
    : tableSelectionTarget?.kind === 'newJoin'
      ? null
      : builder.table
        ? tableRefKey(builder.table)
        : null;
  const disabledTableKeys = new Set(
    activeTables(builder)
      .map(tableRefKey)
      .filter((key) => key !== selectedTableKey),
  );

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
        replaceEditorPath(chartEditPath(created.id, created.mainTable));
      } else {
        const updated = await chartsApi.update(savedId, input);
        replaceEditorPath(chartEditPath(savedId, updated.mainTable));
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

  const changeOptions = (next: Options) => {
    setOptions(next);
    if (!result) setOption(null);
    setDirty(true);
  };

  const pendingViewport = pendingMapViewport(mapViewportSession);
  const mapViewportChangedFromCheckpoint = !mapViewportEquals(
    pendingViewport,
    mapViewportSession.checkpoint,
  );
  const canChangeMapViewportCheckpoint = (chartType === 'map' || chartType === 'geoscatter')
    && !!result
    && mapViewportChangedFromCheckpoint;
  const canSaveMapViewport = canChangeMapViewportCheckpoint && isCompleteMapViewport(pendingViewport);
  const canResetMapViewport = canChangeMapViewportCheckpoint;

  const saveMapViewport = () => {
    if (!canSaveMapViewport) return;
    const next = optionsWithMapViewport(options, chartType, pendingViewport);
    setOptions(next);
    dispatchMapViewport({ type: 'saveCheckpoint', viewport: pendingViewport });
    setDirty(true);
    setToast('지도 영역을 저장했습니다. 최상단 저장 전에는 임베드에 반영되지 않습니다.');
  };

  const resetMapViewport = () => {
    if (!canResetMapViewport) return;
    const next = optionsWithMapViewport(options, chartType, mapViewportSession.checkpoint);
    setOptions(next);
    dispatchMapViewport({ type: 'resetCheckpoint' });
    setToast('마지막 영역 저장 상태로 복원했습니다');
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

      {/* 3분할 Body */}
      <div ref={editorBodyRef} className="flex flex-1 overflow-hidden">
        {leftCollapsed ? (
          <CollapsedPanelRail
            label="데이터 패널"
            controls="schema-sidebar"
            testId="schema-sidebar-rail"
            onExpand={() => setLeftCollapsed(false)}
          />
        ) : (
          <>
            <aside id="schema-sidebar" data-testid="schema-sidebar" style={{ width: leftPanel.size }} className="shrink-0 overflow-y-auto border-r border-border bg-bg-panel">
              <SchemaExplorer
                datasources={datasources}
                tables={tables.filter((t) => t.datasourceId === datasourceId)}
                datasourceId={datasourceId}
                selectedTable={selectedTableKey}
                selection={tableSelectionTarget && selectionLabel
                  ? { label: selectionLabel }
                  : null}
                disabledTableKeys={tableSelectionTarget ? disabledTableKeys : new Set()}
                focusRequestKey={tableSelectionFocusKey}
                onChangeDatasource={changeDatasource}
                onSelectTable={selectTable}
                onCancelSelection={cancelTableSelection}
                onCollapse={() => {
                  cancelTableSelection();
                  setLeftCollapsed(true);
                }}
              />
            </aside>
            <ResizeHandle dir="left" onPointerDown={leftPanel.onPointerDown} />
          </>
        )}

        {builderCollapsed ? (
          <CollapsedPanelRail
            label="노코드 구성·결과"
            controls="data-builder-workspace"
            testId="data-builder-workspace-rail"
            onExpand={expandBuilderPanel}
          />
        ) : (
          <>
            <section ref={builderWorkspaceRef} id="data-builder-workspace" data-testid="data-builder-workspace" className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NocodeBuilder
                  config={builder}
                  chartType={chartType}
                  tables={tables}
                  datasources={datasources}
                  tableSelectionTarget={tableSelectionTarget}
                  onRequestTableSelection={requestTableSelection}
                  onCollapse={() => setBuilderCollapsed(true)}
                  onChange={(b) => {
                    // 데이터 구성 변경 → 기존 실행 결과/SQL/option 무효화(stale 저장 방지). 재실행 필요.
                    applyBuilderChange(b);
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
          </>
        )}

        <aside
          ref={visualWorkspaceRef}
          data-testid="visual-editor-workspace"
          data-option-dock={actualOptionDock}
          data-option-dock-preference={optionDockPreference}
          style={builderCollapsed ? { flex: '1 1 0%', width: 'auto' } : { width: rightPanel.size }}
          className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-bg-panel"
        >
          <div className={`flex min-h-0 flex-1 ${actualOptionDock === 'right' ? 'flex-row' : 'flex-col'}`}>
            <div className="min-h-[180px] min-w-0 flex-1">
              <ChartPreviewPanel
                option={option}
                options={options}
                chartType={chartType}
                loading={initialPreviewLoading}
                error={initialPreviewError}
                wide={builderCollapsed}
                mapViewportEditing={mapViewportSession.editing}
                mapViewport={mapViewportSession.draft}
                mapViewportRevision={mapViewportSession.revision}
                onMapBoundsChange={(bounds, source) => {
                  if (source === 'sync') {
                    dispatchMapViewport({ type: 'syncVisible', bounds });
                    return;
                  }
                  if (!bounds) return;
                  if (source === 'box') {
                    dispatchMapViewport({ type: 'boxSelect', bounds });
                    setDirty(true);
                    return;
                  }
                  dispatchMapViewport({ type: 'roam', bounds });
                  if (mapViewportSession.editing) setDirty(true);
                }}
                onChangeOptions={changeOptions}
              />
            </div>

            {optionEditorCollapsed ? (
              <button
                type="button"
                onClick={() => setOptionEditorCollapsed(false)}
                className={actualOptionDock === 'right'
                  ? 'flex w-10 shrink-0 flex-col items-center justify-center gap-1.5 border-l border-border text-xs font-medium text-text-secondary hover:bg-muted hover:text-text-primary'
                  : 'flex h-10 shrink-0 items-center justify-center gap-1.5 border-t border-border text-xs font-medium text-text-secondary hover:bg-muted hover:text-text-primary'}
              >
                <ChevronUp className={`size-3.5 ${actualOptionDock === 'right' ? '-rotate-90' : ''}`} />
                <span className={actualOptionDock === 'right' ? '[writing-mode:vertical-rl]' : ''}>시각화 옵션 펼치기</span>
              </button>
            ) : (
              <>
                <ResizeHandle
                  dir={actualOptionDock === 'right' ? 'right' : 'up'}
                  onPointerDown={actualOptionDock === 'right' ? optionEditorWidth.onPointerDown : optionEditor.onPointerDown}
                />
                <div
                  data-testid="visual-option-editor"
                  style={actualOptionDock === 'right'
                    ? { width: optionEditorWidth.size }
                    : { height: optionEditor.size, maxHeight: '50%' }}
                  className={actualOptionDock === 'right'
                    ? 'min-h-0 shrink-0 overflow-y-auto border-l border-border'
                    : 'shrink-0 overflow-y-auto border-t border-border'}
                >
                <OptionPanel
                  chartType={chartType}
                  options={options}
                  columns={result?.columns ?? []}
                  rows={result?.rows ?? []}
                  hasResult={!!result}
                  dockPreference={optionDockPreference}
                  actualDock={actualOptionDock}
                  onChangeDockPreference={setOptionDockPreference}
                  mapViewportSession={mapViewportSession}
                  canSaveMapViewport={canSaveMapViewport}
                  canResetMapViewport={canResetMapViewport}
                  savingMapViewport={saving}
                  onSaveMapViewport={saveMapViewport}
                  onResetMapViewport={resetMapViewport}
                  onMapViewportSelectMode={(mode: MapViewportMode) => {
                    dispatchMapViewport({ type: 'selectPanel', mode });
                  }}
                  onMapViewportChange={(viewport: MapViewport) => {
                    dispatchMapViewport({ type: 'apply', viewport });
                    setDirty(true);
                  }}
                  onCollapse={() => setOptionEditorCollapsed(true)}
                  onChangeChartType={(to, next) => {
                    // 데이터 구성은 비파괴 전환(PRD 4.1). 분포 전환(집계 none·버킷 해제)·원형 전환(시리즈 1개)처럼
                    // 구성이 실제로 바뀔 때만 기존 실행 결과가 stale → 무효화. 동일 구조(막대↔선↔원형) 전환은 미리보기 유지.
                    const normalized = normalizeBuilderForChartType(builder, to);
                    const builderChanged = JSON.stringify(normalized) !== JSON.stringify(builder);
                    if (to === 'map' || to === 'geoscatter') {
                      dispatchMapViewport({
                        type: 'restoreGlobal',
                        viewport: normalizeMapViewport(next.map?.viewport),
                      });
                    } else {
                      dispatchMapViewport({ type: 'setEditing', editing: false });
                    }
                    setChartType(to);
                    setOptions(next);
                    setBuilder(normalized);
                    if (builderChanged) resetResults();
                    else if (!result) setOption(null);
                    setDirty(true);
                  }}
                  onChangeOptions={changeOptions}
                />
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {/* 기준 테이블 변경 확인 모달 */}
      {pendingBaseTable != null && (
        <Modal
          title="기준 테이블을 바꿀까요?"
          width={460}
          divided={false}
          onClose={cancelTableSelection}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={cancelTableSelection}>
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
