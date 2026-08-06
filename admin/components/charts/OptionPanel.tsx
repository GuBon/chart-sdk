'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  defaultOf,
  getPath,
  OPTION_EDITOR_TAB_LABELS,
  optionEditorSectionOf,
  optionEditorSectionOrder,
  optionEditorTabOf,
  optionEditorTabsFor,
  setPath,
  switchMajor,
  visibleDefs,
  type MajorType,
  type OptionDef,
  type OptionEditorTab,
  type Options,
} from '@chartsdk/chart-options';
import { resolveChartDesignSize, resolveChartTypography } from '@chartsdk/chart-options/display';
import {
  applyPaletteDirection,
  applyPalettePreset,
  d3PaletteForChartType,
} from '@chartsdk/chart-options/palettes';
import {
  findItemColorOverride,
  normalizeHexColor,
  normalizeItemColorOverrides,
  removeItemColorOverride,
  upsertItemColorOverride,
  type ColorSelection,
} from '@chartsdk/chart-options/colorOverrides';
import { movingAverageOverridesSort } from '@chartsdk/chart-options/statisticalOverlays';
import { seriesDisplayNames } from '@chartsdk/chart-options/fieldDisplayNames';
import type { MapViewport, MapViewportMode } from '@chartsdk/chart-options/geo';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { MapViewportSession } from '@/lib/mapViewportSession';
import { OptionControl, TypographyPolicy, autoTypographySizeOf } from './OptionControl';
import { MapViewportControl } from './MapViewportControl';
import { staticColorSelections } from '@/lib/chartColorSelection';

export type OptionDockPreference = 'auto' | 'right' | 'bottom';
export type OptionDock = Exclude<OptionDockPreference, 'auto'>;

interface Props {
  chartType: MajorType;
  options: Options;
  builderConfig: Record<string, any> | null;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  hasResult: boolean;
  dockPreference: OptionDockPreference;
  actualDock: OptionDock;
  onChangeChartType: (next: MajorType, nextOptions: Options) => void;
  onChangeOptions: (next: Options) => void;
  onChangeDockPreference: (next: OptionDockPreference) => void;
  mapViewportSession: MapViewportSession;
  onMapViewportSelectMode: (mode: MapViewportMode) => void;
  onMapViewportChange: (viewport: MapViewport) => void;
  canSaveMapViewport: boolean;
  canResetMapViewport: boolean;
  savingMapViewport: boolean;
  onSaveMapViewport: () => void;
  onResetMapViewport: () => void;
  colorSelection: ColorSelection | null;
  colorPicking: boolean;
  computedAt: string | null;
  refreshing: boolean;
  refreshError: string | null;
  refreshDisabledReason: string | null;
  onRefreshNow: () => void;
  onColorSelectionChange: (selection: ColorSelection | null) => void;
  onColorPickingChange: (picking: boolean) => void;
  onCollapse?: () => void;
}

/** optionRegistry를 작업 탭·섹션으로 구성한다. 개별 입력 종류의 렌더링은 OptionControl이 담당한다. */
export function OptionPanel({
  chartType,
  options,
  builderConfig,
  columns,
  rows,
  hasResult,
  dockPreference,
  actualDock,
  onChangeChartType,
  onChangeOptions,
  onChangeDockPreference,
  mapViewportSession,
  onMapViewportSelectMode,
  onMapViewportChange,
  canSaveMapViewport,
  canResetMapViewport,
  savingMapViewport,
  onSaveMapViewport,
  onResetMapViewport,
  colorSelection,
  colorPicking,
  computedAt,
  refreshing,
  refreshError,
  refreshDisabledReason,
  onRefreshNow,
  onColorSelectionChange,
  onColorPickingChange,
  onCollapse,
}: Props) {
  const [query, setQuery] = useState('');
  const [activeTabByType, setActiveTabByType] = useState<Partial<Record<MajorType, OptionEditorTab>>>({});
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({});

  const disabled = !hasResult;
  // 이동평균이 켜진 시간축 선 차트는 변환기가 시간 오름차순을 강제하므로 정렬 선택이 결과에 반영되지 않는다.
  // 저장값은 그대로 두고 컨트롤만 잠가 사용자가 효과 없는 값을 바꾸지 않게 한다.
  const sortLockNote = movingAverageOverridesSort(chartType, options, columns)
    ? '이동평균을 사용하는 동안에는 시간 오름차순으로 고정됩니다.'
    : null;
  const normalizedQuery = query.toLowerCase().trim();
  const allDefinitions = visibleDefs(chartType, options);
  const matchedDefinitions = allDefinitions.filter(
    (definition) => !normalizedQuery
      || definition.label.toLowerCase().includes(normalizedQuery)
      || definition.section.toLowerCase().includes(normalizedQuery)
      || optionEditorSectionOf(definition).toLowerCase().includes(normalizedQuery)
      || OPTION_EDITOR_TAB_LABELS[optionEditorTabOf(definition)].toLowerCase().includes(normalizedQuery),
  );
  // 색상 방향 반전은 테마 색상 컨트롤 안에 렌더한다. 검색 시에도 팔레트와 함께 보여 준다.
  const definitions = normalizedQuery
    && matchedDefinitions.some((definition) => definition.key === 'paletteReversed')
    && !matchedDefinitions.some((definition) => definition.key === 'palette')
    ? allDefinitions.filter((definition) => definition.key === 'palette' || matchedDefinitions.includes(definition))
    : matchedDefinitions;
  const availableTabs = optionEditorTabsFor(chartType).filter(
    (tab) => allDefinitions.some((definition) => optionEditorTabOf(definition) === tab),
  );
  const requestedActiveTab = activeTabByType[chartType] ?? 'basic';
  const activeTab = availableTabs.includes(requestedActiveTab) ? requestedActiveTab : availableTabs[0];
  const renderedTabs = normalizedQuery
    ? availableTabs.filter((tab) => definitions.some((definition) => optionEditorTabOf(definition) === tab))
    : activeTab ? [activeTab] : [];
  const typography = resolveChartTypography(options);
  const seriesLabels = seriesDisplayNames(builderConfig, columns);
  const colorTargets = staticColorSelections(chartType, columns, rows, options).map((target) => (
    target.scope === 'series' && seriesLabels[target.seriesName]
      ? { ...target, label: seriesLabels[target.seriesName] }
      : target
  ));
  // 자동 선택은 실제 시리즈에만 적용한다. 원형 조각·지도 지역·점 같은 항목은
  // 반드시 차트에서 고른 뒤 팔레트/직접 지정 색상을 적용한다.
  const effectiveColorSelection = colorSelection
    ?? colorTargets.find((target) => target.scope === 'series')
    ?? null;
  const paletteColors = Array.isArray(options.palette) && options.palette.length > 0
    ? options.palette.map(String)
    : d3PaletteForChartType(chartType, options.palettePreset);

  const valueOf = (definition: OptionDef) => {
    if (definition.key === 'chartType') return chartType;
    const value = getPath(options, definition.key);
    return value === undefined ? defaultOf(definition, chartType) : value;
  };
  const setValue = (definition: OptionDef, value: unknown) => {
    let next = structuredClone(options);
    if (definition.key === 'palettePreset') {
      next = applyPalettePreset(next, chartType, value);
      onColorPickingChange(false);
    } else if (definition.key === 'paletteReversed') {
      next = applyPaletteDirection(next, chartType, value === true);
    } else if (definition.key === 'palette') {
      setPath(next, definition.key, value);
      setPath(next, 'autoColorMap', {});
    } else if (definition.key === 'display.preset' && value === 'custom') {
      // 프리셋에서 사용자 지정으로 들어갈 때 과거 기본 width/height로 튀지 않고
      // 지금 보고 있는 논리 캔버스 크기부터 편집을 시작한다.
      const currentSize = resolveChartDesignSize(options);
      setPath(next, 'display.preset', 'custom');
      setPath(next, 'display.width', currentSize.width);
      setPath(next, 'display.height', currentSize.height);
    } else {
      setPath(next, definition.key, value);
    }
    onChangeOptions(next);
  };
  const applySelectedColor = (color: string) => {
    if (!effectiveColorSelection) return;
    const normalizedColor = normalizeHexColor(color);
    if (!normalizedColor) return;
    const next = structuredClone(options);
    const colorMap = {
      ...((getPath(next, 'colorMap') && typeof getPath(next, 'colorMap') === 'object')
        ? getPath(next, 'colorMap') as Record<string, string>
        : {}),
    };
    if (effectiveColorSelection.scope === 'series') {
      colorMap[effectiveColorSelection.seriesName] = normalizedColor;
      setPath(next, 'colorMap', colorMap);
    } else {
      setPath(next, 'itemColorOverrides', upsertItemColorOverride(
        getPath(next, 'itemColorOverrides'),
        effectiveColorSelection,
        normalizedColor,
      ));
      if (effectiveColorSelection.kind === 'pie') {
        delete colorMap[String(effectiveColorSelection.dimensions[0] ?? '')];
        setPath(next, 'colorMap', colorMap);
      }
    }
    onColorSelectionChange(effectiveColorSelection);
    onChangeOptions(next);
  };
  const clearSelectedColorOverride = () => {
    if (!effectiveColorSelection) return;
    const next = structuredClone(options);
    const colorMap = {
      ...((getPath(next, 'colorMap') && typeof getPath(next, 'colorMap') === 'object')
        ? getPath(next, 'colorMap') as Record<string, string>
        : {}),
    };
    if (effectiveColorSelection.scope === 'series') {
      delete colorMap[effectiveColorSelection.seriesName];
      setPath(next, 'colorMap', colorMap);
    } else {
      setPath(next, 'itemColorOverrides', removeItemColorOverride(
        getPath(next, 'itemColorOverrides'),
        effectiveColorSelection,
      ));
    }
    if (effectiveColorSelection.scope === 'item' && effectiveColorSelection.kind === 'pie') {
      delete colorMap[String(effectiveColorSelection.dimensions[0] ?? '')];
      setPath(next, 'colorMap', colorMap);
    }
    onChangeOptions(next);
  };
  const deleteSelectedChartItem = () => {
    if (effectiveColorSelection?.scope !== 'item') return;
    const next = structuredClone(options);
    const overrides = getPath(next, 'itemColorOverrides');
    const hadOverride = !!findItemColorOverride(overrides, effectiveColorSelection);
    let changed = hadOverride;
    if (hadOverride) {
      setPath(next, 'itemColorOverrides', removeItemColorOverride(overrides, effectiveColorSelection));
    }
    if (effectiveColorSelection.kind === 'pie') {
      const colorMap = {
        ...((getPath(next, 'colorMap') && typeof getPath(next, 'colorMap') === 'object')
          ? getPath(next, 'colorMap') as Record<string, string>
          : {}),
      };
      const itemName = String(effectiveColorSelection.dimensions[0] ?? '');
      if (colorMap[itemName] != null) {
        delete colorMap[itemName];
        setPath(next, 'colorMap', colorMap);
        changed = true;
      }
    }
    onColorSelectionChange(null);
    if (changed) onChangeOptions(next);
  };
  const clearAllChartItemOverrides = () => {
    const overrides = normalizeItemColorOverrides(getPath(options, 'itemColorOverrides'));
    onColorSelectionChange(effectiveColorSelection?.scope === 'item' ? null : effectiveColorSelection);
    onColorPickingChange(false);
    if (overrides.length === 0) return;
    const next = structuredClone(options);
    setPath(next, 'itemColorOverrides', []);
    onChangeOptions(next);
  };
  const changeType = (nextType: MajorType) => {
    if (nextType === chartType) return;
    const { next } = switchMajor(options, chartType, nextType);
    onChangeChartType(nextType, next);
  };
  const setActiveTab = (tab: OptionEditorTab) => {
    setActiveTabByType((previous) => ({ ...previous, [chartType]: tab }));
  };
  const toggleSection = (key: string, open: boolean) => {
    setSectionOverrides((previous) => ({ ...previous, [key]: !open }));
  };
  const focusTab = (tab: OptionEditorTab) => {
    setActiveTab(tab);
    document.getElementById(`option-tab-${tab}`)?.focus();
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-sm font-semibold text-text-primary">시각화 옵션</h2>
        <div className="flex items-center gap-1.5">
          <Select
            data-testid="option-dock-select"
            aria-label="옵션 패널 배치"
            title={dockPreference === 'auto'
              ? `자동 배치 · 현재 ${actualDock === 'right' ? '오른쪽' : '아래쪽'}`
              : `${actualDock === 'right' ? '오른쪽' : '아래쪽'}에 고정됨`}
            value={dockPreference}
            options={[
              { value: 'auto', label: '자동' },
              { value: 'right', label: '오른쪽 고정' },
              { value: 'bottom', label: '아래쪽 고정' },
            ]}
            onChange={(event) => onChangeDockPreference(event.target.value as OptionDockPreference)}
            className="h-7 w-[126px] py-0 pl-2.5 pr-7 text-xs"
          />
          {onCollapse && (
            <button type="button" onClick={onCollapse} aria-label="시각화 옵션 접기" className="flex size-7 items-center justify-center rounded text-text-secondary hover:bg-muted hover:text-text-primary">
              <ChevronDown className="size-4" />
            </button>
          )}
        </div>
      </div>
      <div className="px-4 pb-2">
        <Input id="option-search" name="optionSearch" icon={<Search className="size-3.5" />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="옵션 검색" size="sm" disabled={disabled} />
        {disabled && <p className="mt-2 text-xs text-text-tertiary">실행하면 옵션을 변경할 수 있습니다.</p>}
      </div>

      <div
        role="tablist"
        aria-label="시각화 옵션 분류"
        className="flex min-w-0 gap-1 overflow-x-auto border-b border-border px-4 pt-1"
      >
        {availableTabs.map((tab, index) => {
          const selected = tab === activeTab;
          return (
            <button
              key={tab}
              id={`option-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`option-tabpanel-${tab}`}
              tabIndex={selected ? 0 : -1}
              data-testid={`option-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % availableTabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + availableTabs.length) % availableTabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = availableTabs.length - 1;
                if (nextIndex == null) return;
                event.preventDefault();
                focusTab(availableTabs[nextIndex]);
              }}
              className={`shrink-0 border-b-2 px-2.5 py-2 text-xs font-medium transition-colors ${
                selected
                  ? 'border-primary text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-primary'
              }`}
            >
              {OPTION_EDITOR_TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>

      {normalizedQuery && definitions.length === 0 && (
        <p className="px-4 py-6 text-center text-xs text-text-tertiary">일치하는 옵션이 없습니다.</p>
      )}

      {renderedTabs.map((tab) => {
        const tabDefinitions = definitions.filter((definition) => optionEditorTabOf(definition) === tab);
        if (tabDefinitions.length === 0) return null;
        const discoveredSections = [...new Set(tabDefinitions.map(optionEditorSectionOf))];
        const preferredSections = optionEditorSectionOrder(chartType, tab);
        const sections = [
          ...preferredSections.filter((section) => discoveredSections.includes(section)),
          ...discoveredSections.filter((section) => !preferredSections.includes(section)),
        ];
        return (
          <div
            key={tab}
            id={`option-tabpanel-${tab}`}
            role={normalizedQuery ? 'region' : 'tabpanel'}
            aria-labelledby={`option-tab-${tab}`}
          >
            {normalizedQuery && (
              <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                <span className="text-[11px] font-medium tracking-wide text-text-tertiary">
                  {OPTION_EDITOR_TAB_LABELS[tab]}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {sections.map((section, sectionIndex) => {
              const sectionKey = `${chartType}/${tab}/${section}`;
              const defaultOpen = sectionIndex === 0;
              const open = normalizedQuery ? true : (sectionOverrides[sectionKey] ?? defaultOpen);
              const sectionDefinitions = tabDefinitions.filter(
                (definition) => optionEditorSectionOf(definition) === section,
              );
              return (
                <section key={sectionKey} className="border-b border-border px-4 py-2.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    disabled={Boolean(normalizedQuery)}
                    onClick={() => toggleSection(sectionKey, open)}
                    className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
                  >
                    {open ? <ChevronDown className="size-3.5 text-text-secondary" /> : <ChevronRight className="size-3.5 text-text-secondary" />}
                    <span className="text-[13px] font-semibold text-text-primary">{section}</span>
                  </button>
                  {open && (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      {section === '글꼴' && <TypographyPolicy typography={typography} />}
                      {sectionDefinitions.map((definition) => definition.key === 'paletteReversed' ? null : definition.control === 'mapViewport' ? (
                        <MapViewportControl
                          key={definition.key}
                          chartType={chartType}
                          session={mapViewportSession}
                          disabled={disabled}
                          onChange={onMapViewportChange}
                          onSelectMode={onMapViewportSelectMode}
                          canSave={canSaveMapViewport}
                          canReset={canResetMapViewport}
                          saving={savingMapViewport}
                          onSave={onSaveMapViewport}
                          onReset={onResetMapViewport}
                        />
                      ) : (
                        <OptionControl
                          key={definition.key}
                          def={definition}
                          value={valueOf(definition)}
                          chartType={chartType}
                          chartOptions={options}
                          columns={columns}
                          rows={rows}
                          builderConfig={builderConfig}
                          colorTargets={colorTargets}
                          hasResult={hasResult}
                          disabled={definition.key === 'refreshNow'
                            ? refreshDisabledReason != null
                            : disabled}
                          lockNote={definition.key === 'sortOrder' ? sortLockNote : null}
                          autoValue={autoTypographySizeOf(definition.key, typography)}
                          paletteColors={paletteColors}
                          paletteReversed={options.paletteReversed === true}
                          colorMap={(options.colorMap ?? {}) as Record<string, string>}
                          autoColorMap={(options.autoColorMap ?? {}) as Record<string, string>}
                          itemColorOverrides={options.itemColorOverrides}
                          colorSelection={effectiveColorSelection}
                          colorPicking={colorPicking}
                          action={definition.key === 'refreshNow' ? {
                            pending: refreshing,
                            status: computedAt ? `마지막 계산 ${formatComputedAt(computedAt)}` : null,
                            error: refreshError,
                            disabledReason: refreshDisabledReason,
                            onClick: onRefreshNow,
                          } : undefined}
                          onChange={(value) => setValue(definition, value)}
                          onChangeType={changeType}
                          onSelectColorTarget={(selection) => {
                            onColorSelectionChange(selection);
                            onColorPickingChange(false);
                          }}
                          onColorPickingChange={onColorPickingChange}
                          onApplySelectedColor={applySelectedColor}
                          onClearSelectedColor={clearSelectedColorOverride}
                          onPaletteReversedChange={(reversed) => {
                            const direction = allDefinitions.find((candidate) => candidate.key === 'paletteReversed');
                            if (direction) setValue(direction, reversed);
                          }}
                          onDeleteSelectedChartItem={deleteSelectedChartItem}
                          onClearAllChartItems={clearAllChartItemOverrides}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        );
      })}
      {availableTabs
        .filter((tab) => !renderedTabs.includes(tab))
        .map((tab) => (
          <div
            key={`hidden-${tab}`}
            id={`option-tabpanel-${tab}`}
            role="tabpanel"
            aria-labelledby={`option-tab-${tab}`}
            hidden
          />
        ))}
    </div>
  );
}

function formatComputedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
