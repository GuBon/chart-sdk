'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronsLeft, Play, X } from 'lucide-react';
import type { BuilderConfig, ChartType, Datasource, JoinSpec, SchemaTable, TableRef, WhereCond, YAxisField } from '@/lib/api';
import {
  BUCKET_CHOICES,
  JOIN_TYPE_CHOICES,
  MAX_JOINS,
  OP_CHOICES,
  VALUELESS_OPS,
  activeTables,
  aggChoicesForChart,
  builderExecutionIssue,
  builderWarning,
  CHART_TYPE_REQUIRED_MESSAGE,
  columnDisplayName,
  columnsForBuilder,
  createSampleConfig,
  createSampleSeed,
  fieldDisplayNameForRef,
  isDateType,
  isNumericType,
  isSpatialAreaType,
  isSpatialPointType,
  geoSeriesTypeFor,
  orderTargets,
  relationDisplayName,
  supportsSeriesByForChart,
  supportsAutomaticPointSampling,
  tableHandle,
  tableRefKey,
  updateSampleMode,
  type DataPanelColumnTarget,
} from '@/lib/builder';
import { DEFAULT_SAMPLE_SEED, DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE, MIN_SAMPLE_SIZE, isFullScanTable } from '@chartsdk/chart-options/sampling';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { isRelationSelectable } from '@/lib/relations';
import { cn } from '@/lib/cn';
import type { TableSelectionTarget } from '@/lib/tableSelection';
import { BuilderAccordionGroup } from './BuilderAccordionGroup';
import { ChartTypeSelector, chartTypeSelectionLabel } from './ChartTypeSelector';

// 표본 크기 입력 옆 안내 — 전체 추정 행수(reltuples)는 정확치가 아니라 "약 N행"으로 표기. 작으면 전량 정확 계산.
function sampleTotalHint(estimatedRowCount?: number): string {
  if (!estimatedRowCount || estimatedRowCount <= 0) return '전체 크기 미상 · 실행 후 실제 표본 수와 가능한 통계 구간을 표시합니다';
  const total = `전체 약 ${estimatedRowCount.toLocaleString()}행`;
  return isFullScanTable(estimatedRowCount) ? `${total} — 작아서 전량 정확 계산됩니다` : `${total} 중 무작위 표본`;
}

// S2 중앙 차트 구성 폼(259:191). builderConfig를 편집하고 [실행]을 트리거한다.
interface Props {
  config: BuilderConfig;
  chartType: ChartType;
  /** false면 아직 차트 종류를 고르지 않은 상태 — chartType은 내부 계산용 자리표시자다. */
  chartTypeSelected: boolean;
  chartVariant: string;
  tables: SchemaTable[]; // 모든 데이터소스의 테이블 풀(각 datasourceId 태깅) — 컬럼 해석·다중 소스 조인용
  datasources: Datasource[];
  tableSelectionTarget: TableSelectionTarget | null;
  axisColumnSelectionTarget: DataPanelColumnTarget | null;
  onRequestTableSelection: (target: TableSelectionTarget) => void;
  onRequestAxisColumnSelection: (target: DataPanelColumnTarget) => void;
  onCollapse: () => void;
  onChange: (next: BuilderConfig) => void;
  onChangeChartType: (next: ChartType) => void;
  onChangeChartVariant: (next: string) => void;
  onRun: () => void;
  running: boolean;
}

export function NocodeBuilder({
  config,
  chartType,
  chartTypeSelected,
  chartVariant,
  tables,
  datasources,
  tableSelectionTarget,
  axisColumnSelectionTarget,
  onRequestTableSelection,
  onRequestAxisColumnSelection,
  onCollapse,
  onChange,
  onChangeChartType,
  onChangeChartVariant,
  onRun,
  running,
}: Props) {
  // 조인 시 활성 테이블 전부 qualified, 미조인 시 base unqualified (생성규칙 11.2)
  const colOptions = columnsForBuilder(config, tables);
  const xType = colOptions.find((c) => c.value === config.xAxis)?.type;
  const isScatter = chartType === 'scatter';
  const isPie = chartType === 'pie';
  const isBoxplot = chartType === 'boxplot';
  const isMap = chartType === 'map';
  const isGeoScatter = chartType === 'geoscatter';
  const geoSeriesType = geoSeriesTypeFor(config, chartType);
  const pointInput = isGeoScatter || (isMap && geoSeriesType === 'heatmap');
  const areaInput = isMap && geoSeriesType === 'map';
  const geoPointMode = config.geoPoint?.mode ?? 'columns';
  const spatialGeoPoint = pointInput && geoPointMode === 'spatial';
  const geoAreaMode = config.geoArea?.mode ?? 'regions';
  const spatialGeoArea = areaInput && geoAreaMode === 'spatial';
  const spatialGeometry = spatialGeoPoint || spatialGeoArea;
  const spatialPointOptions = colOptions
    .filter((column) => isSpatialPointType(column.type))
    .map((column) => ({ ...column, label: `${column.label} · ${column.type}` }));
  const spatialAreaOptions = colOptions
    .filter((column) => isSpatialAreaType(column.type))
    .map((column) => ({ ...column, label: `${column.label} · ${column.type}` }));
  const areaNameOptions = colOptions.filter((column) => !/\b(?:geometry|geography)\b/i.test(column.type));
  const numericOptions = colOptions.filter((column) => isNumericType(column.type));
  // 값 축 수 상한. 지도 포인트의 이름·값·크기는 아래 전용 역할 선택기로 받는다.
  const supportsSeriesBy = supportsSeriesByForChart(chartType);
  const maxSeries = isPie || areaInput || isBoxplot || !!config.seriesBy || pointInput ? 1 : Infinity;
  const hideBucket = isScatter || isBoxplot || pointInput;
  const xLabel = areaInput ? '지역' : isBoxplot ? '카테고리' : pointInput ? '경도' : 'X축';
  const yLabel = areaInput ? '값' : isBoxplot || isPie ? '값' : pointInput ? '위도' : 'Y축 값';
  const yAggChoices = aggChoicesForChart(chartType);
  // 차트 종류 미선택 안내가 테이블 선택 안내보다 먼저 보인다.
  const executionIssue = chartTypeSelected
    ? builderExecutionIssue(config, chartType, tables)
    : CHART_TYPE_REQUIRED_MESSAGE;
  const warning = builderWarning(config);
  const canRun = !executionIssue;
  const firstCol = (pointInput ? numericOptions[0] : colOptions[0])?.value ?? '';
  const pendingNewYAxis = axisColumnSelectionTarget?.kind === 'y'
    && axisColumnSelectionTarget.index === config.yAxis.length;

  const patch = (p: Partial<BuilderConfig>) => onChange({ ...config, ...p });

  // ── 다중 소스 테이블 참조 헬퍼 ──
  const findByKey = (key: string) => tables.find((t) => tableRefKey(t) === key);
  const dsName = (id: number) => datasources.find((d) => d.id === id)?.name ?? `ds${id}`;
  const baseSchemaTable = config.table ? findByKey(tableRefKey(config.table)) : undefined;
  const baseTableLabel = config.table
    ? [config.table.schema, config.table.name].filter(Boolean).join('.')
    : '원본 테이블이 비어 있습니다';

  const clearXAxis = () => {
    patch({
      xAxis: null,
      xAxisBucket: null,
      orderBy: config.yAxis.length === 0 ? null : config.orderBy,
    });
  };

  const setY = (i: number, p: Partial<YAxisField>) =>
    patch({ yAxis: config.yAxis.map((y, idx) => (idx === i ? { ...y, ...p } : y)) });
  const addY = () => onRequestAxisColumnSelection({ kind: 'y', index: config.yAxis.length });
  const removeY = (i: number) => {
    const yAxis = config.yAxis.filter((_, idx) => idx !== i);
    patch({ yAxis, orderBy: !config.xAxis && yAxis.length === 0 ? null : config.orderBy });
  };
  const changeSeriesBy = (seriesBy: string) => patch({
    seriesBy: seriesBy || null,
    seriesOrder: config.seriesOrder ?? 'asc',
    yAxis: seriesBy ? config.yAxis.slice(0, 1) : config.yAxis,
  });

  const setW = (i: number, p: Partial<WhereCond>) =>
    patch({ where: config.where.map((w, idx) => (idx === i ? { ...w, ...p } : w)) });
  const addW = () => patch({ where: [...config.where, { column: firstCol, op: 'eq', value: '' }] });
  const removeW = (i: number) => patch({ where: config.where.filter((_, idx) => idx !== i) });
  const changeWhereOp = (i: number, op: WhereCond['op']) => {
    const current = config.where[i]?.value;
    setW(i, { op, value: defaultValueForOp(op, current) });
  };

  // ── 조인 (생성규칙 11장) ──
  const joins = config.joins ?? [];
  const rawValueMode = config.yAxis.some((y) => y.agg === 'none');
  const colsOf = (ref: TableRef) => tables.find((t) => tableRefKey(t) === tableRefKey(ref))?.columns ?? [];
  // 조인 컬럼 참조는 테이블 핸들로 qualified — 백엔드가 핸들을 소스로 해석(§11.2). 동명 테이블은 핸들이 달라 구분됨.
  const qualOpts = (refs: TableRef[]) =>
    refs.flatMap((ref) => colsOf(ref).map((c) => {
      const value = `${tableHandle(ref)}.${c.name}`;
      const displayName = columnDisplayName(c);
      return { value, label: displayName === c.name ? value : `${displayName} (${value})` };
    }));
  const setJoin = (i: number, p: Partial<JoinSpec>) => patch({ joins: joins.map((j, idx) => (idx === i ? { ...j, ...p } : j)) });
  const setJoinOn = (i: number, side: 'leftColumn' | 'rightColumn', col: string) => setJoin(i, { on: { ...joins[i].on, [side]: col } });
  const removeJoin = (i: number) => patch({ joins: joins.filter((_, idx) => idx !== i) });

  const changeGeoPointMode = (mode: 'columns' | 'spatial') => {
    if (mode === 'spatial') {
      patch({
        xAxis: null,
        xAxisBucket: null,
        yAxis: [],
        orderBy: null,
        geoPoint: {
          mode: 'spatial',
          spatialColumn: config.geoPoint?.spatialColumn ?? spatialPointOptions[0]?.value ?? null,
          nameColumn: config.geoPoint?.nameColumn ?? null,
          valueColumn: config.geoPoint?.valueColumn ?? null,
          sizeColumn: config.geoPoint?.sizeColumn ?? null,
        },
      });
      return;
    }
    patch({
      xAxis: null,
      xAxisBucket: null,
      yAxis: [],
      orderBy: null,
      geoPoint: {
        mode: 'columns',
        nameColumn: config.geoPoint?.nameColumn ?? null,
        valueColumn: config.geoPoint?.valueColumn ?? null,
        sizeColumn: config.geoPoint?.sizeColumn ?? null,
      },
    });
  };
  const changeGeoAreaMode = (mode: 'regions' | 'spatial') => {
    if (mode === 'spatial') {
      patch({
        xAxis: null,
        xAxisBucket: null,
        yAxis: [],
        orderBy: null,
        geoArea: {
          mode: 'spatial',
          spatialColumn: config.geoArea?.spatialColumn ?? spatialAreaOptions[0]?.value ?? null,
          nameColumn: config.geoArea?.nameColumn ?? areaNameOptions[0]?.value ?? null,
          valueColumn: config.geoArea?.valueColumn ?? numericOptions[0]?.value ?? null,
        },
      });
      return;
    }
    patch({ xAxis: null, xAxisBucket: null, yAxis: [], orderBy: null, geoArea: { mode: 'regions' } });
  };
  const unusedTable = !!config.table && tables.some(
    (t) => isRelationSelectable(t) && !activeTables(config).some((ref) => tableRefKey(ref) === tableRefKey(t)),
  );
  const automaticSamplingDisabled = config.sample?.mode === 'auto'
    && !supportsAutomaticPointSampling(config, chartType);
  const sampleSourceHint = automaticSamplingDisabled
    ? '자동 표본은 원본 점을 그리는 산점도·지도 포인트에만 적용됩니다. 현재 차트는 정확 실행됩니다.'
    : joins.length > 0
    ? '조인 결과에서 무작위 행 표본'
    : baseSchemaTable?.relationType === 'VIEW'
      ? 'View 조회 결과에서 무작위 행 표본'
      : sampleTotalHint(baseSchemaTable?.estimatedRowCount);
  const sortTargets = orderTargets(config, tables);
  const dataGroupSummary = config.table
    ? [
        baseTableLabel,
        joins.length > 0 ? `조인 ${joins.length}개` : null,
        config.xAxis ? 'X축 설정' : null,
        config.yAxis.length > 0 ? `Y축 ${config.yAxis.length}개` : null,
        config.where.length > 0 ? `조건 ${config.where.length}개` : null,
        config.sample ? '표본' : null,
      ].filter(Boolean).join(' · ')
    : '테이블을 선택하세요';

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun && !running) onRun();
      }}
    >
      {/* 구성 헤더 + 내부 정의 모드 탭 */}
      <div className="border-b border-border">
        <div className="flex h-12 items-center gap-3 px-4">
          <span className={cn('min-w-0 truncate text-sm', config.table ? 'font-bold text-text-primary' : 'font-medium text-text-tertiary')} title={baseTableLabel}>
            {baseTableLabel}
          </span>
          <div className="flex-1" />
          {executionIssue ? (
            <span className="min-w-0 truncate text-xs text-danger" title={executionIssue}>{executionIssue}</span>
          ) : warning ? (
            <span className="min-w-0 truncate text-xs text-amber-600" title={warning}>{warning}</span>
          ) : null}
          {/* 접기는 데이터 패널과 같이 헤더 행의 오른쪽 끝에 둔다. */}
          <button
            type="button"
            onClick={onCollapse}
            aria-label="데이터 구성·결과 접기"
            aria-controls="data-builder-workspace"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium text-text-secondary hover:bg-muted hover:text-text-primary"
          >
            <ChevronsLeft className="size-3.5" />
            <span className="hidden xl:inline">접기</span>
          </button>
        </div>
        <div className="flex h-10 items-stretch gap-1 px-2 xl:px-4">
          <div role="tablist" aria-label="차트 정의 방식" className="flex min-w-0 items-stretch gap-1">
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="flex shrink-0 items-center whitespace-nowrap border-b-2 border-primary px-2 text-sm font-medium text-text-primary"
            >
              차트 구성
            </button>
            <button
              type="button"
              role="tab"
              aria-selected="false"
              disabled
              title="SQL · 준비 중"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2 text-sm text-text-tertiary"
            >
              SQL
              <span className="hidden rounded bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary xl:inline">준비 중</span>
            </button>
          </div>
          <div className="flex-1" />
          <span className="hidden shrink-0 self-center whitespace-nowrap text-xs text-text-tertiary 2xl:inline">Ctrl + Enter</span>
          <Button
            id="builder-run"
            size="sm"
            className="shrink-0 self-center"
            icon={<Play className="size-3.5" />}
            aria-label={running ? '실행 중' : '실행'}
            disabled={!canRun || running}
            onClick={onRun}
          >
            <span className="hidden xl:inline">{running ? '실행 중…' : '실행'}</span>
          </Button>
        </div>
      </div>

      <BuilderAccordionGroup
        id="builder-chart-type"
        title="차트 종류"
        summary={chartTypeSelected ? chartTypeSelectionLabel(chartType, chartVariant) : '차트 종류를 선택하세요'}
      >
        <ChartTypeSelector
          chartType={chartTypeSelected ? chartType : null}
          variant={chartVariant}
          onChangeChartType={onChangeChartType}
          onChangeVariant={onChangeChartVariant}
        />
      </BuilderAccordionGroup>

      <BuilderAccordionGroup
        id="builder-data-config"
        title="데이터 구성"
        summary={dataGroupSummary}
        contentClassName="flex flex-col gap-4 p-4"
      >
        {/* 테이블 조인 (생성규칙 11장) — base 다음, 컬럼 참조는 qualified */}
        {config.table && (
          <Row label="조인">
            <div className="flex flex-col gap-2">
              {joins.map((j, i) => {
                const priorTables: TableRef[] = [config.table!, ...joins.slice(0, i).map((x) => x.table)];
                const joinSchemaTable = findByKey(tableRefKey(j.table));
                return (
                  <div key={i} className="flex items-center gap-2">
                    <TableSelectionField
                      testId={`join-table-selector-${i}`}
                      label={`${i + 1}번째 조인 테이블`}
                      table={joinSchemaTable}
                      datasourceName={joinSchemaTable ? dsName(joinSchemaTable.datasourceId) : null}
                      active={tableSelectionTarget?.kind === 'join' && tableSelectionTarget.index === i}
                      compact
                      onClick={() => onRequestTableSelection({ kind: 'join', index: i })}
                    />
                    <div className="w-24">
                      <Select aria-label="조인 종류" value={j.type} onChange={(e) => setJoin(i, { type: e.target.value as JoinSpec['type'] })} options={JOIN_TYPE_CHOICES} />
                    </div>
                    <span className="text-[13px] text-text-secondary">ON</span>
                    <div className="w-40">
                      <Select aria-label="조인 기준 컬럼" value={j.on.leftColumn} onChange={(e) => setJoinOn(i, 'leftColumn', e.target.value)} options={qualOpts(priorTables)} placeholder="컬럼" />
                    </div>
                    <span className="text-[13px] text-text-secondary">=</span>
                    <div className="w-44">
                      <Select aria-label="조인 대상 컬럼" value={j.on.rightColumn} onChange={(e) => setJoinOn(i, 'rightColumn', e.target.value)} options={qualOpts([j.table])} placeholder="컬럼" />
                    </div>
                    <button type="button" aria-label="조인 제거" onClick={() => removeJoin(i)} className="text-text-tertiary hover:text-danger">
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              {tableSelectionTarget?.kind === 'newJoin' && (
                <div className="flex items-center gap-2" data-testid="new-join-table-selector">
                  <TableSelectionField
                    label={`${joins.length + 1}번째 조인 테이블`}
                    table={undefined}
                    datasourceName={null}
                    active
                    compact
                    onClick={() => onRequestTableSelection({ kind: 'newJoin' })}
                  />
                </div>
              )}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7"
                  onClick={() => onRequestTableSelection({ kind: 'newJoin' })}
                  disabled={!unusedTable || joins.length >= MAX_JOINS || tableSelectionTarget?.kind === 'newJoin'}
                >
                  + 조인 추가
                </Button>
              </div>
            </div>
          </Row>
        )}

        {pointInput && (
          <Row label="좌표 방식">
            <div className="w-60">
              <Select
                id="builder-geo-point-mode"
                aria-label="좌표 방식"
                value={geoPointMode}
                onChange={(e) => changeGeoPointMode(e.target.value as 'columns' | 'spatial')}
                options={[
                  { value: 'columns', label: '경도 · 위도 컬럼' },
                  { value: 'spatial', label: '공간 Point 컬럼' },
                ]}
              />
            </div>
          </Row>
        )}

        {areaInput && (
          <Row label="지도 경계">
            <div className="w-60">
              <Select
                id="builder-geo-area-mode"
                aria-label="지도 경계 방식"
                value={geoAreaMode}
                onChange={(e) => changeGeoAreaMode(e.target.value as 'regions' | 'spatial')}
                options={[
                  { value: 'regions', label: '내장 행정구역' },
                  { value: 'spatial', label: '공간 Polygon 컬럼' },
                ]}
              />
            </div>
          </Row>
        )}

        {spatialGeoArea && (
          <>
            <Row label="공간 경계">
              <div className="w-72">
                <Select
                  id="builder-spatial-area-column"
                  aria-label="공간 Polygon 컬럼"
                  value={config.geoArea?.spatialColumn ?? ''}
                  onChange={(e) => patch({ geoArea: { ...config.geoArea!, mode: 'spatial', spatialColumn: e.target.value || null } })}
                  options={spatialAreaOptions}
                  placeholder="geometry/geography Polygon 선택"
                />
              </div>
              <span className="text-[13px] text-text-tertiary">Polygon·MultiPolygon을 WGS84 GeoJSON 경계로 변환합니다</span>
            </Row>
            <Row label="영역 이름">
              <div className="w-60">
                <Select
                  id="builder-spatial-area-name"
                  aria-label="영역 이름 컬럼"
                  value={config.geoArea?.nameColumn ?? ''}
                  onChange={(e) => patch({ geoArea: { ...config.geoArea!, mode: 'spatial', nameColumn: e.target.value || null } })}
                  options={areaNameOptions}
                  placeholder="이름 컬럼 선택"
                />
              </div>
              <span className="text-[13px] text-text-tertiary">라벨·툴팁에 표시할 고유 이름을 권장합니다</span>
            </Row>
            <Row label="영역 값">
              <div className="w-60">
                <Select
                  id="builder-spatial-area-value"
                  aria-label="영역 값 컬럼"
                  value={config.geoArea?.valueColumn ?? ''}
                  onChange={(e) => patch({ geoArea: { ...config.geoArea!, mode: 'spatial', valueColumn: e.target.value || null } })}
                  options={numericOptions}
                  placeholder="숫자 컬럼 선택"
                />
              </div>
              <span className="text-[13px] text-text-tertiary">색상 강도(visualMap)에 사용할 숫자 원본값입니다</span>
            </Row>
          </>
        )}

        {spatialGeoPoint && (
          <>
            <Row label="공간 Point">
              <div className="w-72">
                <Select
                  id="builder-spatial-point-column"
                  aria-label="공간 Point 컬럼"
                  value={config.geoPoint?.spatialColumn ?? ''}
                  onChange={(e) => patch({ geoPoint: { ...config.geoPoint!, mode: 'spatial', spatialColumn: e.target.value || null } })}
                  options={spatialPointOptions}
                  placeholder="geometry/geography Point 선택"
                />
              </div>
              <span className="text-[13px] text-text-tertiary">SRID가 지정된 PostGIS Point를 WGS84 경도·위도로 변환합니다</span>
            </Row>
          </>
        )}

        {!spatialGeometry && <Row label={xLabel}>
          <div className="flex items-center gap-2">
            <ColumnSelectionField
              testId="builder-x-axis"
              label={xLabel}
              valueLabel={colOptions.find((column) => column.value === config.xAxis)?.label ?? config.xAxis}
              active={axisColumnSelectionTarget?.kind === 'x'}
              onClick={() => onRequestAxisColumnSelection({ kind: 'x' })}
            />
            {config.xAxis && (
              <button type="button" aria-label={`${xLabel} 컬럼 제거`} onClick={clearXAxis} className="text-text-tertiary hover:text-danger">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {areaInput && <span className="text-[13px] text-text-tertiary">지역 정식 명칭 컬럼(예: 서울특별시)</span>}
          {pointInput && <span className="text-[13px] text-text-tertiary">WGS84 경도 숫자 컬럼 — 위도는 아래에서 선택합니다</span>}
          {isDateType(xType) && !hideBucket && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-text-secondary">묶기</span>
              <div className="w-28">
                <Select
                  aria-label="X축 묶기"
                  value={config.xAxisBucket ?? 'month'}
                  onChange={(e) => patch({ xAxisBucket: e.target.value as BuilderConfig['xAxisBucket'] })}
                  options={BUCKET_CHOICES}
                />
              </div>
            </div>
          )}
        </Row>}

        {!spatialGeometry && <Row label={yLabel}>
          <div className="flex flex-col gap-2">
            {config.yAxis.map((y, i) => (
              <div key={i} className="flex items-center gap-2">
                <ColumnSelectionField
                  testId={`builder-y-column-${i}`}
                  label={`Y축 ${i + 1}`}
                  valueLabel={colOptions.find((column) => column.value === y.column)?.label ?? y.column}
                  active={axisColumnSelectionTarget?.kind === 'y' && axisColumnSelectionTarget.index === i}
                  compact
                  onClick={() => onRequestAxisColumnSelection({ kind: 'y', index: i })}
                />
                <div className="w-36">
                  <Select
                    id={`builder-y-agg-${i}`}
                    name={`builderYAgg${i}`}
                    aria-label={`Y축 ${i + 1} 값 방식`}
                    value={y.agg}
                    onChange={(e) => setY(i, { agg: e.target.value as YAxisField['agg'] })}
                    options={yAggChoices}
                  />
                </div>
                <span className="text-[13px] text-text-secondary">표시 이름</span>
                <div className="w-28">
                  <Input
                    size="sm"
                    value={y.alias ?? ''}
                    onChange={(e) => setY(i, { alias: e.target.value })}
                    placeholder={fieldDisplayNameForRef(y.column, config, tables) || '자동'}
                    aria-label={`Y축 ${i + 1} 표시 이름`}
                  />
                </div>
                <button type="button" aria-label="값 제거" onClick={() => removeY(i)} className="text-text-tertiary hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {pendingNewYAxis && (
              <div data-testid="pending-y-axis-selector">
                <ColumnSelectionField
                  testId={`builder-y-column-${config.yAxis.length}`}
                  label={`Y축 ${config.yAxis.length + 1}`}
                  valueLabel={null}
                  active
                  compact
                  onClick={() => onRequestAxisColumnSelection({ kind: 'y', index: config.yAxis.length })}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button id="builder-add-series" variant="secondary" size="sm" className="h-7" onClick={addY} disabled={!config.table || pendingNewYAxis || config.yAxis.length >= maxSeries}>
                + 값 추가
              </Button>
            </div>
            <p className="text-xs text-text-tertiary">
              원본값이 기본이며, 집계를 선택하면 X축과 계열 기준으로 그룹화합니다.
            </p>
          </div>
        </Row>}

        {pointInput && (
          <>
            <Row label="이름">
              <div className="w-60">
                <Select
                  id="builder-geo-point-name"
                  aria-label="지도 포인트 이름 컬럼"
                  value={config.geoPoint?.nameColumn ?? ''}
                  onChange={(event) => patch({ geoPoint: { ...config.geoPoint, mode: geoPointMode, nameColumn: event.target.value || null } })}
                  options={areaNameOptions}
                  placeholder="사용 안 함"
                />
              </div>
              <span className="text-[13px] text-text-tertiary">라벨과 툴팁에 표시할 이름입니다</span>
            </Row>
            <Row label="값">
              <div className="w-60">
                <Select
                  id="builder-geo-point-value"
                  aria-label="지도 포인트 값 컬럼"
                  value={config.geoPoint?.valueColumn ?? ''}
                  onChange={(event) => patch({ geoPoint: { ...config.geoPoint, mode: geoPointMode, valueColumn: event.target.value || null } })}
                  options={numericOptions}
                  placeholder={geoSeriesType === 'heatmap' ? '행마다 1 사용' : '사용 안 함'}
                />
              </div>
              <span className="text-[13px] text-text-tertiary">{geoSeriesType === 'heatmap' ? '히트맵 강도값이며, 미선택 시 각 행을 1로 계산합니다' : '툴팁과 데이터 값에 사용할 숫자입니다'}</span>
            </Row>
            {geoSeriesType !== 'heatmap' && (
              <Row label="크기값">
                <div className="w-60">
                  <Select
                    id="builder-geo-point-size"
                    aria-label="지도 포인트 크기값 컬럼"
                    value={config.geoPoint?.sizeColumn ?? ''}
                    onChange={(event) => patch({ geoPoint: { ...config.geoPoint, mode: geoPointMode, sizeColumn: event.target.value || null } })}
                    options={numericOptions}
                    placeholder="사용 안 함"
                  />
                </div>
                <span className="text-[13px] text-text-tertiary">선택하면 값 범위에 따라 점 크기를 조절합니다</span>
              </Row>
            )}
          </>
        )}

        {supportsSeriesBy && <Row label="계열(그룹) 기준">
          <div className="w-60">
            <Select
              id="builder-series-by"
              aria-label="계열 그룹 기준"
              value={config.seriesBy ?? ''}
              onChange={(event) => changeSeriesBy(event.target.value)}
              options={colOptions.filter((column) => ![
                config.xAxis,
                config.yAxis[0]?.column,
                config.geoPoint?.nameColumn,
                config.geoPoint?.valueColumn,
                config.geoPoint?.sizeColumn,
                config.geoArea?.nameColumn,
                config.geoArea?.valueColumn,
                config.geoArea?.spatialColumn,
              ].includes(column.value))}
              placeholder="사용 안 함"
            />
          </div>
          {config.seriesBy && (
            <div className="w-32">
              <Select
                aria-label="계열 정렬"
                value={config.seriesOrder ?? 'asc'}
                onChange={(event) => patch({ seriesOrder: event.target.value as BuilderConfig['seriesOrder'] })}
                options={[
                  { value: 'asc', label: '오름차순' },
                  { value: 'desc', label: '내림차순' },
                  { value: 'data', label: '데이터 순서' },
                ]}
              />
            </div>
          )}
          <span className="text-[13px] text-text-tertiary">{pointInput ? '카테고리마다 별도 지도 계열과 스타일을 만듭니다' : '예: 지역(X) · 인구수(Y) · 연도(계열)'}</span>
        </Row>}

        <Row label="조건">
          <div className="flex flex-col gap-2">
            {config.where.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-40">
                  <Select aria-label="조건 컬럼" value={w.column} onChange={(e) => setW(i, { column: e.target.value })} options={colOptions} placeholder="컬럼" />
                </div>
                <div className="w-32">
                  <Select aria-label="조건 연산자" value={w.op} onChange={(e) => changeWhereOp(i, e.target.value as WhereCond['op'])} options={OP_CHOICES} />
                </div>
                <WhereValueControl cond={w} onChange={(value) => setW(i, { value })} />
                <button type="button" aria-label="조건 제거" onClick={() => removeW(i)} className="text-text-tertiary hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="h-7" onClick={addW} disabled={!config.table}>
              + 조건 추가
            </Button>
          </div>
        </Row>

        {!spatialGeometry && <Row label="정렬">
          <div className="w-40">
            <Select
              aria-label="정렬 기준"
              value={config.orderBy?.target ?? ''}
              onChange={(e) => patch({ orderBy: e.target.value ? { target: e.target.value, direction: config.orderBy?.direction ?? 'desc' } : null })}
              options={sortTargets}
              placeholder="없음"
            />
          </div>
          {config.orderBy && (
            <div className="w-28">
              <Select
                aria-label="정렬 방향"
                value={config.orderBy.direction}
                onChange={(e) => patch({ orderBy: { target: config.orderBy!.target, direction: e.target.value as 'asc' | 'desc' } })}
                options={[{ value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }]}
              />
            </div>
          )}
        </Row>}

        <Row label="표본 추출">
          <Switch
            aria-label="표본 추출"
            checked={!!config.sample}
            onChange={(on) => {
              patch({ sample: on ? createSampleConfig() : null });
            }}
          />
          {config.sample ? (
            <>
              <div className="w-32">
                <Select
                  aria-label="표본 방식"
                  value={config.sample.mode === 'manual' ? 'manual' : 'auto'}
                  onChange={(e) => patch({ sample: updateSampleMode(config.sample, e.target.value === 'manual' ? 'manual' : 'auto') })}
                  options={[
                    { value: 'auto', label: '자동 (서버 결정)' },
                    { value: 'manual', label: '직접 지정' },
                  ]}
                />
              </div>
              {config.sample.mode === 'manual' && (
                <div className="flex items-center gap-1">
                  <div className="w-24">
                    <Input
                      size="sm"
                      type="number"
                      min={MIN_SAMPLE_SIZE}
                      max={MAX_SAMPLE_SIZE}
                      aria-label="표본 크기"
                      placeholder={String(DEFAULT_SAMPLE_SIZE)}
                      value={config.sample.size ? String(config.sample.size) : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        patch({ sample: { ...config.sample!, size: v === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0)) } });
                      }}
                    />
                  </div>
                  <span className="text-[13px] text-text-secondary">행</span>
                </div>
              )}
              <span className="text-[13px] text-text-tertiary" data-testid="sample-total-hint">
                {sampleSourceHint}
              </span>
              <button
                type="button"
                className="text-xs text-text-secondary underline-offset-2 hover:underline"
                aria-label="표본 다시 뽑기"
                title={`현재 seed ${config.sample.seed ?? DEFAULT_SAMPLE_SEED}`}
                onClick={() => patch({ sample: { ...config.sample!, seed: createSampleSeed() } })}
              >
                다시 뽑기
              </button>
            </>
          ) : (
            <span className="text-[13px] text-text-tertiary">
              {rawValueMode
                ? '무작위로 선택한 원본 행만 차트에 표시합니다. 지도는 표본에 포함되지 않은 영역이 비어 보일 수 있습니다.'
                : '무작위 표본으로 빠르게 확인 — SUM·COUNT는 표본값, AVG·표준편차·분산은 가능한 경우 95% 추정 구간을 표시합니다.'}
            </span>
          )}
        </Row>
      </BuilderAccordionGroup>

    </div>
  );
}

function ColumnSelectionField({
  testId,
  label,
  valueLabel,
  active,
  compact = false,
  onClick,
}: {
  testId: string;
  label: string;
  valueLabel: string | null | undefined;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={testId}
      type="button"
      data-testid={testId}
      aria-label={`${label} 컬럼 ${valueLabel ? '변경' : '선택'}`}
      aria-pressed={active}
      onClick={onClick}
      title={valueLabel || `${label} 컬럼 선택`}
      className={cn(
        'relative flex h-8 items-center rounded-md border bg-bg-panel pl-3 text-left text-[13px] text-text-primary outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
        compact ? 'w-44' : 'w-60',
        active ? 'border-primary pr-16 ring-2 ring-primary/15' : 'border-border pr-9',
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate whitespace-nowrap', !valueLabel && 'text-text-tertiary')}>
        {valueLabel || '데이터 패널에서 컬럼 선택'}
      </span>
      {active ? (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium text-primary">선택 중</span>
      ) : (
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
      )}
    </button>
  );
}

function TableSelectionField({
  testId,
  label,
  table,
  datasourceName,
  active,
  compact = false,
  onClick,
  onChangeClick,
}: {
  testId?: string;
  label: string;
  table: SchemaTable | undefined;
  datasourceName: string | null;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
  onChangeClick?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid={testId}
        aria-label={`${label} ${table && onChangeClick ? '원본 데이터 보기' : table ? '변경' : '선택'}`}
        aria-pressed={active}
        onClick={onClick}
        title={table && datasourceName
          ? `${relationDisplayName(table)} · ${datasourceName} · ${table.schema}.${table.name}`
          : label}
        className={cn(
          'relative flex h-8 items-center rounded-md border bg-bg-panel pl-3 text-left text-[13px] text-text-primary outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
          compact ? 'w-48' : 'w-72',
          active ? 'border-primary pr-16 ring-2 ring-primary/15' : 'border-border pr-12',
        )}
      >
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
          {table && datasourceName
            ? `${relationDisplayName(table)} · ${datasourceName}`
            : '테이블·View 선택'}
        </span>
        {active ? (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-medium text-primary">선택 중</span>
        ) : table && onChangeClick ? (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-text-tertiary">보기</span>
        ) : (
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
        )}
      </button>
      {onChangeClick && (
        <button
          type="button"
          onClick={onChangeClick}
          aria-label={`${label} 변경`}
          className="h-8 rounded-md border border-border bg-bg-panel px-3 text-xs text-text-secondary hover:border-primary/50 hover:text-text-primary"
        >
          변경
        </button>
      )}
    </div>
  );
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function defaultValueForOp(op: WhereCond['op'], current: WhereCond['value']): WhereCond['value'] {
  if (VALUELESS_OPS.includes(op)) return undefined;
  if (op === 'in') return Array.isArray(current) ? current : splitList(String(current ?? ''));
  if (op === 'between') {
    if (Array.isArray(current)) return [current[0] ?? '', current[1] ?? ''];
    return [current ?? '', ''];
  }
  return Array.isArray(current) ? current[0] ?? '' : current ?? '';
}

function WhereValueControl({ cond, onChange }: { cond: WhereCond; onChange: (value: WhereCond['value']) => void }) {
  if (VALUELESS_OPS.includes(cond.op)) return null;

  if (cond.op === 'between') {
    const values = Array.isArray(cond.value) ? cond.value : [cond.value ?? '', ''];
    return (
      <>
        <div className="w-28">
          <Input size="sm" value={String(values[0] ?? '')} onChange={(e) => onChange([e.target.value, values[1] ?? ''])} placeholder="시작" />
        </div>
        <div className="w-28">
          <Input size="sm" value={String(values[1] ?? '')} onChange={(e) => onChange([values[0] ?? '', e.target.value])} placeholder="끝" />
        </div>
      </>
    );
  }

  if (cond.op === 'in') {
    const value = Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value ?? '');
    return (
      <div className="w-48">
        <Input size="sm" value={value} onChange={(e) => onChange(splitList(e.target.value))} placeholder="값1, 값2, 값3" />
      </div>
    );
  }

  return (
    <div className="w-36">
      <Input size="sm" value={String(cond.value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="값" />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-1.5 text-[13px] text-text-secondary">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
