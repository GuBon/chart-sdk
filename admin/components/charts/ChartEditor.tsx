'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronUp, ChevronsRight, Plus, RotateCcw } from 'lucide-react';
import { defaultsFor, optionsWithDefaults, type MajorType, type Options } from '@chartsdk/chart-options';
import type { ColorSelection } from '@chartsdk/chart-options/colorOverrides';
import { normalizeMapViewport, type MapViewport, type MapViewportMode } from '@chartsdk/chart-options/geo';
import { ApiError, chartsApi, datasourcesApi, queryApi, schemaApi } from '@/lib/api';
import type { BuilderConfig, ChartDataResponse, ChartInput, Datasource, GeoSeriesType, QueryResult, RefreshMode, SchemaTable, TableRef } from '@/lib/api';
import {
  activeTables,
  assignDataPanelColumn,
  builderExecutionIssue,
  builderValidationIssue,
  dataPanelColumnSelectionIssue,
  emptyBuilder,
  emptyJoin,
  isTableQueryMode,
  migrateBuilderConfig,
  normalizeBuilder,
  normalizeBuilderForChartType,
  tableRefKey,
  withFieldDisplayNameSnapshots,
  withUniqueHandle,
  type DataPanelColumnTarget,
} from '@/lib/builder';
import { chartEditPath } from '@/lib/chartRoutes';
import { chartSaveIssue } from '@/lib/chartSave';
import { optionDockThresholds, resolveAutoOptionDock } from '@/lib/chartPreviewLayout';
import {
  cloneEditorSnapshot,
  createEditorSnapshot,
  editorDefinitionEquals,
  withResolvedAutoColorMap,
  type EditorDefinitionSnapshot,
  type EditorPreviewSnapshot,
  type SavedEditorSnapshot,
} from '@/lib/editorSnapshot';
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
const OPTION_DOCK_MANUAL_MIN_WIDTH = 640;

/** mode=rows SQL에 실제로 참여하는 구성만 비교한다. 축·계열·표본 변경은 원본 미리보기를 무효화하지 않는다. */
function rawPreviewSignature(config: BuilderConfig): string {
  const rawOrder = config.orderBy?.target.startsWith('column:') ? config.orderBy : null;
  return JSON.stringify({
    table: config.table ?? null,
    joins: config.joins ?? [],
    where: config.where ?? [],
    orderBy: rawOrder,
  });
}

function configuredNoCodeSettings(config: BuilderConfig): string[] {
  const settings: string[] = [];
  const hasGeoPointFields = config.geoPoint != null
    && Object.entries(config.geoPoint).some(([key, value]) => key !== 'mode' && value != null && value !== '');
  const hasGeoAreaFields = config.geoArea != null
    && (config.geoArea.mode === 'spatial'
      || Object.entries(config.geoArea).some(([key, value]) => key !== 'mode' && value != null && value !== ''));

  if ((config.joins?.length ?? 0) > 0) settings.push('조인');
  if (config.xAxis || config.xAxisBucket) settings.push('X축');
  if (config.yAxis.length > 0) settings.push('Y축');
  if (config.seriesBy) settings.push('계열');
  if (config.where.length > 0) settings.push('조건');
  if (config.orderBy) settings.push('정렬');
  if (config.sample) settings.push('표본 추출');
  if (config.limit != null) settings.push('조회 제한');
  if (
    hasGeoPointFields
    || hasGeoAreaFields
    || config.geoSeriesType === 'heatmap'
    || config.geoSeriesType === 'effectScatter'
  ) settings.push('지도 데이터');
  return settings;
}

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

function autoColorMapFromOption(option: Record<string, unknown> | null): Record<string, string> | null {
  const colors = option?.__chartsdkAutoColorMap;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return null;
  return colors as Record<string, string>;
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
  const [rawTable, setRawTable] = useState<SchemaTable | null>(null);
  const [resultKind, setResultKind] = useState<'chart' | 'table' | null>(null);
  const [option, setOption] = useState<Record<string, unknown> | null>(null);
  const [generatedSql, setGeneratedSql] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [rawRunning, setRawRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [initialPreviewLoading, setInitialPreviewLoading] = useState(chartId != null);
  const [initialPreviewError, setInitialPreviewError] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('raw');
  const rawRequestId = useRef(0);
  const runRequestId = useRef(0);
  const optionPreviewRequestId = useRef(0);
  const requestedCatalogIds = useRef(new Set<number>());
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const builderWorkspaceRef = useRef<HTMLElement>(null);
  const visualWorkspaceRef = useRef<HTMLElement>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingBaseTable, setPendingBaseTable] = useState<SchemaTable | null>(null);
  const [tableSelectionTarget, setTableSelectionTarget] = useState<TableSelectionTarget | null>(null);
  const [axisColumnSelectionTarget, setAxisColumnSelectionTarget] = useState<DataPanelColumnTarget | null>(null);
  const [tableSelectionFocusKey, setTableSelectionFocusKey] = useState(0);
  const [leavePath, setLeavePath] = useState<string | null>(null);
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
  const [savedSnapshot, setSavedSnapshot] = useState<SavedEditorSnapshot | null>(null);
  const [colorSelection, setColorSelection] = useState<ColorSelection | null>(null);
  const [colorPicking, setColorPicking] = useState(false);

  const applyResolvedOption = (nextOption: Record<string, unknown> | null) => {
    setOption(nextOption);
    const colors = autoColorMapFromOption(nextOption);
    if (colors) {
      setOptions((current) => withResolvedAutoColorMap(current, colors));
    }
  };

  useEffect(() => {
    void datasourcesApi.list().then(setDatasources).catch(() => setToast('데이터소스를 불러오지 못했습니다. 백엔드 연결을 확인하세요.'));
  }, []);

  // 다중 소스 조인 지원 — 모든 데이터소스의 테이블을 하나의 풀로 로드(각 datasourceId 태깅).
  useEffect(() => {
    if (datasources.length === 0) {
      setTables([]);
      return;
    }
    const available = new Set(datasources.map((datasource) => datasource.id));
    const needed = new Set<number>();
    if (datasourceId != null && available.has(datasourceId)) needed.add(datasourceId);
    activeTables(builder).forEach((table) => {
      if (available.has(table.datasourceId)) needed.add(table.datasourceId);
    });
    needed.forEach((id) => {
      if (requestedCatalogIds.current.has(id)) return;
      requestedCatalogIds.current.add(id);
      void schemaApi.tables(id)
        .then((loaded) => {
          setTables((current) => [
            ...current.filter((table) => table.datasourceId !== id),
            ...loaded,
          ]);
        })
        .catch(() => setToast(`ds${id} 스키마를 불러오지 못했습니다.`));
    });
  }, [builder, datasourceId, datasources]);

  // Legacy definitions predate field-name snapshots. Adopt the current effective names once,
  // then include them in the saved baseline so later catalog edits cannot silently rename a chart.
  useEffect(() => {
    if (tables.length === 0 || !savedSnapshot) return;
    if (JSON.stringify(builder) !== JSON.stringify(savedSnapshot.definition.builder)) return;
    const enriched = withFieldDisplayNameSnapshots(builder, tables);
    if (JSON.stringify(enriched) === JSON.stringify(builder)) return;
    setBuilder(enriched);
    setSavedSnapshot((current) => current
      ? createEditorSnapshot(
          { ...current.definition, builder: enriched },
          current.preview,
        )
      : current);
  }, [builder, savedSnapshot, tables]);

  // 기존 차트 진입 → 정의와 마지막 저장 캐시를 함께 복원한다. 고객 DB 쿼리를 자동 재실행하지 않는다.
  // 레거시 문자열 테이블 참조는 TableRef 로 승격한다.
  useEffect(() => {
    if (chartId == null) return;
    let cancelled = false;
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(null);
    setInitialPreviewLoading(true);
    setInitialPreviewError(null);
    setComputedAt(null);
    setRefreshError(null);
    setRefreshing(false);
    setSavedSnapshot(null);
    setResult(null);
    setResultKind(null);
    setColorSelection(null);
    setColorPicking(false);
    rawRequestId.current += 1;
    setRaw(null);
    setRawTable(null);
    setRawRunning(false);
    setRawError(null);
    setOption(null);
    setGeneratedSql(null);

    void Promise.allSettled([chartsApi.get(chartId), chartsApi.preview(chartId)] as const)
      .then(([definitionResult, previewResult]) => {
        if (cancelled) return;
        const restoredPreviewOption = previewResult.status === 'fulfilled' ? previewResult.value.option : null;
        const restoredResult = previewResult.status === 'fulfilled'
          ? queryResultFromPreview(previewResult.value)
          : null;

        if (definitionResult.status === 'fulfilled') {
          const c = definitionResult.value;
          let restoredBuilder = migrateBuilderConfig(normalizeBuilder(c.builderConfig), c.datasourceId);
          let restoredOptions = optionsWithDefaults(c.chartType, c.options);
          if (c.chartType === 'map' || c.chartType === 'geoscatter') {
            restoredBuilder = normalizeBuilderForChartType({
              ...restoredBuilder,
              geoSeriesType: restoredOptions.variant as GeoSeriesType,
            }, c.chartType);
          }
          const restoredAutoColors = autoColorMapFromOption(restoredPreviewOption);
          if (restoredAutoColors) restoredOptions = { ...restoredOptions, autoColorMap: restoredAutoColors };

          setName(c.name);
          setDatasourceId(c.datasourceId);
          setBuilder(restoredBuilder);
          setChartType(c.chartType);
          setOptions(restoredOptions);
          dispatchMapViewport({
            type: 'restoreGlobal',
            viewport: normalizeMapViewport(restoredOptions.map?.viewport),
          });
          setGeneratedSql(c.sqlQuery || null);
          setSavedSnapshot(createEditorSnapshot(
            {
              name: c.name,
              datasourceId: c.datasourceId,
              builder: restoredBuilder,
              chartType: c.chartType,
              options: restoredOptions,
            },
            {
              result: restoredResult,
              resultKind: restoredResult ? 'chart' : null,
              option: restoredPreviewOption,
              generatedSql: c.sqlQuery || null,
            },
          ));
          setDirty(false);
          const canonicalPath = chartEditPath(c.id, c.mainTable);
          replaceEditorPath(canonicalPath);
        } else {
          setToast('차트를 불러오지 못했습니다.');
        }

        if (previewResult.status === 'fulfilled') {
          setComputedAt(previewResult.value.computedAt);
          setOption(restoredPreviewOption);
          if (restoredResult) {
            setResult(restoredResult);
            setResultKind('chart');
          }
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
    const requestId = ++optionPreviewRequestId.current;
    if (!result || resultKind !== 'chart') return;
    const t = setTimeout(() => {
      void queryApi
        .preview({
          chartType,
          options,
          builderConfig: builder,
          rows: { columns: result.columns, rows: result.rows },
        })
        .then((r) => {
          if (requestId === optionPreviewRequestId.current) applyResolvedOption(r.option);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [builder, chartType, options, result, resultKind]);

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
      setAutoOptionDock((current) => resolveAutoOptionDock({
        workspaceWidth: entry.contentRect.width,
        optionPanelWidth: optionEditorWidth.size,
        optionPanelCollapsed: optionEditorCollapsed,
        currentDock: current,
      }));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [optionEditorCollapsed, optionEditorWidth.size]);

  // 오른쪽 고정을 복원하거나 선택했을 때 미리보기가 찌그러지지 않도록 우측 작업영역을 먼저 확보한다.
  useEffect(() => {
    if (!optionDockPreferenceRestored || optionDockPreference !== 'right' || builderCollapsed) return;
    const editorWidth = editorBodyRef.current?.clientWidth;
    if (editorWidth == null) return;
    const leftWidth = leftCollapsed ? 40 : leftPanel.size;
    const availableWidth = editorWidth - leftWidth - PANEL_RESTORE_MIN_WIDTH;
    if (availableWidth >= OPTION_DOCK_MANUAL_MIN_WIDTH) {
      const preferredWidth = optionDockThresholds({
        optionPanelWidth: optionEditorWidth.size,
        optionPanelCollapsed: optionEditorCollapsed,
      }).enterRightAt;
      const targetWidth = Math.min(preferredWidth, availableWidth);
      if (rightPanelSize < targetWidth) setRightPanelSize(targetWidth);
    } else {
      setBuilderCollapsed(true);
    }
  }, [
    builderCollapsed,
    leftCollapsed,
    leftPanel.size,
    optionDockPreference,
    optionDockPreferenceRestored,
    optionEditorCollapsed,
    optionEditorWidth.size,
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

  const invalidateRawPreview = () => {
    rawRequestId.current += 1;
    setRaw(null);
    setRawRunning(false);
    setRawError(null);
  };

  const resetRawPreview = () => {
    invalidateRawPreview();
    setRawTable(null);
  };

  const resetResults = () => {
    runRequestId.current += 1;
    setRunning(false);
    setResult(null);
    setResultKind(null);
    setOption(null);
    setGeneratedSql(null);
    setRunError(null);
    setInitialPreviewLoading(false);
    setInitialPreviewError(null);
    dispatchMapViewport({ type: 'setEditing', editing: false });
    setColorSelection(null);
    setColorPicking(false);
  };

  // 사이드바 데이터소스 = 탐색 컨텍스트. 소스 변경은 드롭다운 필터만 바꾸고 구성은 보존(비파괴).
  const changeDatasource = (id: number) => {
    setDatasourceId(id);
    resetRawPreview();
  };

  const requestTableSelection = (target: TableSelectionTarget) => {
    setPendingBaseTable(null);
    setAxisColumnSelectionTarget(null);
    setTableSelectionTarget(target);

    const currentRef = target.kind === 'join'
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

  const requestAxisColumnSelection = (target: DataPanelColumnTarget) => {
    if (target.kind === 'y' && (target.index < 0 || target.index > builder.yAxis.length)) return;
    setPendingBaseTable(null);
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(target);
    if (!activeTables(builder).some((table) => table.datasourceId === datasourceId) && builder.table) {
      setDatasourceId(builder.table.datasourceId);
    }
    setLeftCollapsed(false);
  };

  const cancelExplorerSelection = useCallback(() => {
    setPendingBaseTable(null);
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(null);
  }, []);

  useEffect(() => {
    if (!tableSelectionTarget && axisColumnSelectionTarget == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelExplorerSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [axisColumnSelectionTarget, cancelExplorerSelection, tableSelectionTarget]);

  const applyBuilderChange = (next: BuilderConfig) => {
    const normalized = withFieldDisplayNameSnapshots(
      normalizeBuilderForChartType(next, chartType),
      tables,
    );
    const rawQueryChanged = rawPreviewSignature(normalized) !== rawPreviewSignature(builder);
    if ((normalized.seriesBy ?? null) !== (builder.seriesBy ?? null)) {
      // The series namespace changes when a grouping dimension is added, removed, or replaced.
      // Start that namespace at the beginning of the selected palette; filters and sorting keep
      // using the persisted map because they do not change seriesBy.
      setOptions((current) => ({ ...current, autoColorMap: undefined }));
    }
    setBuilder(normalized);
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(null);
    setDirty(true);
    resetResults();
    // X/Y·계열·표본 설정은 원본 행 SQL을 바꾸지 않는다. 이 경우 실행 전까지 현재 원본
    // 미리보기를 유지한다. JOIN·WHERE·원본 컬럼 정렬이 바뀐 경우에만 지연 조회를 무효화한다.
    if (rawQueryChanged) invalidateRawPreview();
  };

  // 실행·저장에 쓰는 primary 데이터소스는 base 테이블에서 파생(사이드바 탐색 소스와 무관).
  const primaryDatasourceId = builder.table?.datasourceId ?? datasourceId;

  const previewRawTable = async (t: SchemaTable) => {
    const requestId = ++rawRequestId.current;
    setRawTable(t);
    setRaw(null);
    setRawRunning(true);
    setRawError(null);
    setResultTab('raw');
    try {
      const preview = await schemaApi.preview(t.schema, t.name, t.datasourceId);
      if (requestId !== rawRequestId.current) return;
      setRaw(preview);
    } catch (e) {
      if (requestId !== rawRequestId.current) return;
      setRaw(null);
      setRawError(e instanceof ApiError ? e.message : '원본 데이터를 불러오지 못했습니다.');
    } finally {
      if (requestId === rawRequestId.current) setRawRunning(false);
    }
  };

  // 원본 테이블 확정(나머지 구성 초기화 + 원본 미리보기). 확인 절차는 selectTable 이 담당.
  const applyBaseTable = async (t: SchemaTable) => {
    setBuilder({
      ...emptyBuilder(),
      table: { datasourceId: t.datasourceId, schema: t.schema, name: t.name },
    });
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(null);
    resetResults();
    setDirty(true);
    // 원본 미리보기는 부가 기능 — 실패해도 테이블 선택은 유지(미처리 rejection·크래시 방지).
    await previewRawTable(t);
  };

  // 조인 선택 중이면 조인에 적용하고, 그 외에는 왼쪽 테이블을 원본으로 적용한다.
  const selectTable = async (t: SchemaTable) => {
    const refOf = (table: SchemaTable): TableRef => ({ datasourceId: table.datasourceId, schema: table.schema, name: table.name });
    if (!tableSelectionTarget) {
      if (builder.table && tableRefKey(builder.table) === tableRefKey(t)) {
        await previewRawTable(t);
        return;
      }
      if (builder.table && configuredNoCodeSettings(builder).length > 0) {
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
  const baseTableKey = builder.table ? tableRefKey(builder.table) : null;
  const pendingAxisColumnTarget = axisColumnSelectionTarget?.kind === 'x'
    || (axisColumnSelectionTarget?.kind === 'y' && axisColumnSelectionTarget.index <= builder.yAxis.length)
    ? axisColumnSelectionTarget
    : null;
  const dataPanelColumnTarget = pendingAxisColumnTarget ?? { kind: 'x' as const };
  const columnTargetLabel = dataPanelColumnTarget.kind === 'y'
    ? `Y축 ${dataPanelColumnTarget.index + 1}`
    : 'X축';
  const columnSelectionExpandKey = pendingAxisColumnTarget
    ? activeTables(builder).find((table) => table.datasourceId === datasourceId)
    : null;
  const disabledTableKeys = new Set(
    activeTables(builder)
      .map(tableRefKey)
      .filter((key) => key !== selectedTableKey),
  );

  const selectDataPanelColumn = (table: SchemaTable, column: SchemaTable['columns'][number]) => {
    const next = assignDataPanelColumn(builder, chartType, table, column.name, dataPanelColumnTarget);
    if (next) applyBuilderChange(next);
  };

  const runBuilder = async () => {
    const issue = builderExecutionIssue(builder, chartType, tables);
    if (issue || primaryDatasourceId == null) {
      if (issue) setRunError(issue);
      return;
    }
    setAxisColumnSelectionTarget(null);
    const requestId = ++runRequestId.current;
    setRunning(true);
    setRunError(null);
    setInitialPreviewLoading(false);
    setInitialPreviewError(null);
    setResultTab('result');
    setColorSelection(null);
    setColorPicking(false);
    try {
      const tableQuery = isTableQueryMode(builder, chartType);
      const res = await queryApi.runBuilder({
        datasourceId: primaryDatasourceId,
        builderConfig: builder,
        chartType,
        options,
        mode: tableQuery ? 'rows' : 'aggregate',
      });
      if (requestId !== runRequestId.current) return;
      setResult(res);
      setResultKind(tableQuery ? 'table' : 'chart');
      setGeneratedSql(res.generatedSql ?? null);
      if (tableQuery) setOption(null);
      else applyResolvedOption(res.option ?? null);
      setResultTab('result');
    } catch (e) {
      if (requestId !== runRequestId.current) return;
      setRunError(e instanceof ApiError ? e.message : '실행에 실패했습니다.');
    } finally {
      if (requestId === runRequestId.current) setRunning(false);
    }
  };

  const loadBuilderRows = async () => {
    if (!builder.table || primaryDatasourceId == null || rawRunning) return;
    const requestId = ++rawRequestId.current;
    setRawTable(tables.find((table) => tableRefKey(table) === tableRefKey(builder.table!)) ?? null);
    setRaw(null);
    setRawRunning(true);
    setRawError(null);
    try {
      const rows = await queryApi.runBuilder({
        datasourceId: primaryDatasourceId,
        builderConfig: builder,
        chartType,
        options,
        mode: 'rows',
      });
      if (requestId !== rawRequestId.current) return;
      setRaw(rows);
    } catch (error) {
      if (requestId !== rawRequestId.current) return;
      setRawError(error instanceof ApiError ? error.message : '원본 데이터를 불러오지 못했습니다.');
    } finally {
      if (requestId === rawRequestId.current) setRawRunning(false);
    }
  };

  const changeResultTab = (tab: ResultTab) => {
    setResultTab(tab);
    if (tab === 'raw' && !raw && !rawRunning) void loadBuilderRows();
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const optionsToPersist = optionsWithMapViewport(options, chartType, mapViewportSession.draft);
  const currentDefinitionSnapshot: EditorDefinitionSnapshot = {
    name,
    datasourceId: primaryDatasourceId,
    builder,
    chartType,
    options: optionsToPersist,
  };
  const hasUnsavedChanges = savedSnapshot
    ? !editorDefinitionEquals(currentDefinitionSnapshot, savedSnapshot.definition)
    : dirty;

  // 저장 = 실행 + 캐시 시드(PRD 7.3). 버튼은 누를 수 있게 두고, 미충족 조건을 문구로 안내한다.
  // 실제 저장은 현재 구성으로 실행 성공한 차트 결과가 있을 때만 진행해 stale SQL 저장을 막는다.
  const saveIssue = chartSaveIssue({
    name,
    builderIssue: builderValidationIssue(builder, chartType, tables),
    hasDatasource: primaryDatasourceId != null,
    hasResult: result != null,
    resultKind,
    running,
    runError,
  });

  const save = async (): Promise<boolean> => {
    if (saveIssue || primaryDatasourceId == null) {
      setToast(saveIssue ?? '데이터소스와 테이블을 선택해야 저장할 수 있습니다.');
      return false;
    }
    setSaving(true);
    try {
      const optionsToSave = optionsToPersist;
      const { jsonb, cols } = splitOptions(optionsToSave);
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
      let persistedChartId = savedId;
      if (savedId == null) {
        const created = await chartsApi.create(input);
        persistedChartId = created.id;
        setSavedId(created.id); // 이후 저장은 update — 중복 생성 방지, 임베드 버튼 활성화
        replaceEditorPath(chartEditPath(created.id, created.mainTable));
      } else {
        const updated = await chartsApi.update(savedId, input);
        replaceEditorPath(chartEditPath(savedId, updated.mainTable));
      }
      setOptions(optionsToSave);
      const savedDefinition: EditorDefinitionSnapshot = {
        name: name.trim(),
        datasourceId: primaryDatasourceId,
        builder,
        chartType,
        options: optionsToSave,
      };
      const savedPreview: EditorPreviewSnapshot = {
        result,
        resultKind,
        option,
        generatedSql,
      };
      setName(savedDefinition.name);
      setSavedSnapshot(createEditorSnapshot(savedDefinition, savedPreview));
      dispatchMapViewport({
        type: 'saveGlobal',
        viewport: normalizeMapViewport(optionsToSave.map?.viewport),
      });
      setDirty(false);
      setToast('저장되었습니다');
      if (persistedChartId != null) {
        try {
          const preview = await chartsApi.preview(persistedChartId);
          setComputedAt(preview.computedAt);
        } catch {
          // 저장은 성공했다. 기준 시각 조회 실패가 저장 성공을 뒤집지는 않는다.
        }
      }
      return true;
    } catch (e) {
      setToast(e instanceof ApiError ? e.message : '저장에 실패했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const refreshNow = async () => {
    if (savedId == null || hasUnsavedChanges || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const refreshed = await chartsApi.refresh(savedId);
      setComputedAt(refreshed.computedAt);

      try {
        const preview = await chartsApi.preview(savedId);
        const refreshedResult = queryResultFromPreview(preview);
        const refreshedAutoColors = autoColorMapFromOption(preview.option);
        setComputedAt(preview.computedAt || refreshed.computedAt);
        applyResolvedOption(preview.option);
        if (refreshedResult) {
          setResult(refreshedResult);
          setResultKind('chart');
          setResultTab('result');
        }
        setInitialPreviewError(null);
        setSavedSnapshot((current) => current
          ? createEditorSnapshot({
              ...current.definition,
              options: withResolvedAutoColorMap(current.definition.options, refreshedAutoColors),
            }, {
              ...current.preview,
              result: refreshedResult ?? current.preview.result,
              resultKind: refreshedResult ? 'chart' : current.preview.resultKind,
              option: preview.option,
            })
          : current);
        setToast('데이터를 갱신했습니다');
      } catch (error) {
        setRefreshError(error instanceof ApiError
          ? `갱신은 완료됐지만 미리보기를 다시 불러오지 못했습니다. ${error.message}`
          : '갱신은 완료됐지만 미리보기를 다시 불러오지 못했습니다.');
      }
    } catch (error) {
      setRefreshError(error instanceof ApiError ? error.message : '데이터 갱신에 실패했습니다.');
    } finally {
      setRefreshing(false);
    }
  };

  const navigateFromEditor = (path: string) => {
    if (hasUnsavedChanges) setLeavePath(path);
    else router.push(path);
  };

  const goList = () => navigateFromEditor('/');
  const createChart = () => navigateFromEditor('/charts/new');

  const changeOptions = (next: Options) => {
    if ((chartType === 'map' || chartType === 'geoscatter') && next.variant !== options.variant) {
      const geoSeriesType = next.variant as GeoSeriesType;
      const normalized = normalizeBuilderForChartType({ ...builder, geoSeriesType }, chartType);
      setBuilder(normalized);
      setAxisColumnSelectionTarget(null);
      setColorSelection(null);
      setColorPicking(false);
      resetResults();
    }
    setOptions(next);
    if (!result || resultKind !== 'chart') setOption(null);
    setDirty(true);
  };

  const changeColorPicking = (picking: boolean) => {
    setColorPicking(picking);
    if (picking) dispatchMapViewport({ type: 'setEditing', editing: false });
  };

  const resetOptions = () => {
    if (!savedSnapshot) return;
    runRequestId.current += 1;
    optionPreviewRequestId.current += 1;
    rawRequestId.current += 1;

    const restored = cloneEditorSnapshot(savedSnapshot);
    setName(restored.definition.name);
    setDatasourceId(restored.definition.datasourceId);
    setBuilder(restored.definition.builder);
    setChartType(restored.definition.chartType);
    setOptions(restored.definition.options);
    setResult(restored.preview.result);
    setResultKind(restored.preview.resultKind);
    setOption(restored.preview.option);
    setGeneratedSql(restored.preview.generatedSql);
    setRunning(false);
    setRunError(null);
    setInitialPreviewLoading(false);
    setInitialPreviewError(null);
    setRaw(null);
    setRawTable(null);
    setRawRunning(false);
    setRawError(null);
    setResultTab('result');
    setTableSelectionTarget(null);
    setAxisColumnSelectionTarget(null);
    setPendingBaseTable(null);
    dispatchMapViewport({
      type: 'restoreGlobal',
      viewport: normalizeMapViewport(restored.definition.options.map?.viewport),
    });
    setColorSelection(null);
    setColorPicking(false);
    setDirty(false);
    setToast('마지막 저장 상태로 복원했습니다');
  };

  const canResetOptions = savedSnapshot != null && hasUnsavedChanges;

  const pendingViewport = pendingMapViewport(mapViewportSession);
  const mapViewportChangedFromCheckpoint = !mapViewportEquals(
    pendingViewport,
    mapViewportSession.checkpoint,
  );
  const canChangeMapViewportCheckpoint = (chartType === 'map' || chartType === 'geoscatter')
    && resultKind === 'chart'
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

  const rawTableLabel = rawTable
    ? `${datasources.find((datasource) => datasource.id === rawTable.datasourceId)?.name ?? `ds${rawTable.datasourceId}`} · ${rawTable.schema}.${rawTable.name}`
    : null;

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
        <div className="flex-1" />
        {savedId != null && (
          <>
            <Button variant="secondary" size="sm" className="h-8" icon={<Plus className="size-3.5" />} onClick={createChart}>
              새 차트
            </Button>
            <div className="h-5 w-px shrink-0 bg-border" aria-hidden />
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-8"
          icon={<RotateCcw className="size-3.5" />}
          disabled={!canResetOptions || saving}
          title="차트 이름·데이터 구성·유형·옵션을 마지막 저장 상태로 되돌리기"
          onClick={resetOptions}
        >
          초기화
        </Button>
        <Button variant="secondary" size="sm" className="h-8" disabled={saving} onClick={save}>
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
                baseTableKey={baseTableKey}
                selection={tableSelectionTarget && selectionLabel
                  ? {
                      label: selectionLabel,
                      cancelLabel: '테이블 선택 취소',
                      focusSearch: true,
                    }
                  : pendingAxisColumnTarget
                    ? {
                        label: `${columnTargetLabel}에 넣을 컬럼을 선택하세요`,
                        cancelLabel: `${columnTargetLabel} 컬럼 선택 취소`,
                        expandTableKey: columnSelectionExpandKey ? tableRefKey(columnSelectionExpandKey) : null,
                      }
                    : null}
                disabledTableKeys={tableSelectionTarget ? disabledTableKeys : new Set()}
                focusRequestKey={tableSelectionFocusKey}
                columnTargetLabel={columnTargetLabel}
                onChangeDatasource={changeDatasource}
                onSelectTable={selectTable}
                columnSelectionIssue={(table, column) => tableSelectionTarget
                  ? '먼저 테이블 선택을 완료하거나 취소하세요.'
                  : dataPanelColumnSelectionIssue(
                      builder,
                      chartType,
                      table,
                      column.name,
                      dataPanelColumnTarget,
                    )}
                onSelectColumn={selectDataPanelColumn}
                onCancelSelection={cancelExplorerSelection}
                onCollapse={() => {
                  cancelExplorerSelection();
                  setLeftCollapsed(true);
                }}
              />
            </aside>
            <ResizeHandle dir="left" onPointerDown={leftPanel.onPointerDown} />
          </>
        )}

        {builderCollapsed ? (
          <CollapsedPanelRail
            label="데이터 구성·결과"
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
                  axisColumnSelectionTarget={pendingAxisColumnTarget}
                  onRequestTableSelection={requestTableSelection}
                  onRequestAxisColumnSelection={requestAxisColumnSelection}
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
                  rawTableLabel={rawTableLabel}
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
                computedAt={computedAt}
                loading={initialPreviewLoading}
                error={initialPreviewError}
                mapViewportEditing={mapViewportSession.editing}
                mapViewport={mapViewportSession.draft}
                mapViewportRevision={mapViewportSession.revision}
                colorPicking={colorPicking}
                colorSelection={colorSelection}
                onColorSelection={setColorSelection}
                onColorPickingChange={changeColorPicking}
                onMapBoundsChange={(bounds, source) => {
                  if (source === 'sync') {
                    dispatchMapViewport({ type: 'syncVisible', bounds });
                    return;
                  }
                  if (!bounds) return;
                  if (source === 'box') {
                    setColorPicking(false);
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
                  builderConfig={builder}
                  columns={resultKind === 'chart' ? result?.columns ?? [] : []}
                  rows={resultKind === 'chart' ? result?.rows ?? [] : []}
                  hasResult={resultKind === 'chart' && !!result}
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
                    if (mode === 'manual') setColorPicking(false);
                    dispatchMapViewport({ type: 'selectPanel', mode });
                  }}
                  onMapViewportChange={(viewport: MapViewport) => {
                    setColorPicking(false);
                    dispatchMapViewport({ type: 'apply', viewport });
                    setDirty(true);
                  }}
                  colorSelection={colorSelection}
                  colorPicking={colorPicking}
                  computedAt={computedAt}
                  refreshing={refreshing}
                  refreshError={refreshError}
                  refreshDisabledReason={savedId == null
                    ? '차트를 저장한 뒤 갱신할 수 있습니다.'
                    : hasUnsavedChanges
                      ? '변경사항을 저장한 뒤 갱신하세요.'
                      : null}
                  onRefreshNow={refreshNow}
                  onColorSelectionChange={setColorSelection}
                  onColorPickingChange={changeColorPicking}
                  onCollapse={() => setOptionEditorCollapsed(true)}
                  onChangeChartType={(to, next) => {
                    // 데이터 구성은 비파괴 전환(PRD 4.1). 분포 전환(집계 none·버킷 해제)·원형 전환(시리즈 1개)처럼
                    // 구성이 실제로 바뀔 때만 기존 실행 결과가 stale → 무효화. 동일 구조(막대↔선↔원형) 전환은 미리보기 유지.
                    const normalized = normalizeBuilderForChartType(
                      to === 'map' || to === 'geoscatter'
                        ? { ...builder, geoSeriesType: next.variant as GeoSeriesType }
                        : builder,
                      to,
                    );
                    const builderChanged = JSON.stringify(normalized) !== JSON.stringify(builder);
                    setColorSelection(null);
                    setColorPicking(false);
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
                    setAxisColumnSelectionTarget(null);
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

      {/* 원본 테이블 변경 확인 모달 */}
      {pendingBaseTable != null && (
        <Modal
          title="원본 테이블을 변경할까요?"
          width={460}
          divided={false}
          onClose={cancelTableSelection}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={cancelTableSelection}>
                아니요
              </Button>
              <Button size="sm" className="h-[34px]" onClick={() => { const t = pendingBaseTable; setPendingBaseTable(null); if (t) void applyBaseTable(t); }}>
                예
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-text-secondary">
            현재 {configuredNoCodeSettings(builder).join('·')} 항목이 설정되어 있습니다. 정말 변경하시겠습니까? 변경하면 원본 테이블 외의 설정은 초기화됩니다.
          </p>
        </Modal>
      )}

      {/* 이탈확인 모달 */}
      {leavePath != null && (
        <Modal
          title="저장되지 않은 변경이 있습니다"
          width={460}
          divided={false}
          onClose={() => setLeavePath(null)}
          footer={
            <>
              <Button variant="secondary" size="sm" className="h-[34px]" onClick={() => setLeavePath(null)}>
                계속 편집
              </Button>
              <Button variant="ghost" size="sm" className="h-[34px]" onClick={() => router.push(leavePath)}>
                저장 안 함
              </Button>
              <Button size="sm" className="h-[34px]" disabled={saving} onClick={async () => { if (await save()) router.push(leavePath); }}>
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
          chart={{ id: savedId }}
          onClose={() => setEmbedOpen(false)}
        />
      )}

      {/* 저장 토스트 */}
      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
    </>
  );
}
