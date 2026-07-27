'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  defaultOf,
  getPath,
  setPath,
  switchMajor,
  visibleDefs,
  type MajorType,
  type OptionDef,
  type Options,
} from '@chartsdk/chart-options';
import { resolveChartTypography } from '@chartsdk/chart-options/display';
import type { MapViewport, MapViewportMode } from '@chartsdk/chart-options/geo';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { chartTypeLabel } from '@/lib/chartTypes';
import type { MapViewportSession } from '@/lib/mapViewportSession';
import { OptionControl, TypographyPolicy, coercePaletteIndex } from './OptionControl';
import { MapViewportControl } from './MapViewportControl';

export type OptionDockPreference = 'auto' | 'right' | 'bottom';
export type OptionDock = Exclude<OptionDockPreference, 'auto'>;

interface Props {
  chartType: MajorType;
  options: Options;
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
  onCollapse?: () => void;
}

const ZONE_LABEL: Record<string, string> = { common: '공통', axis: '좌표 · 축', type: '대분류 전용' };
const ZONE_ORDER = ['common', 'axis', 'type'];

/** optionRegistry를 검색·존·섹션으로 구성한다. 개별 입력 종류의 렌더링은 OptionControl이 담당한다. */
export function OptionPanel({
  chartType,
  options,
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
  onCollapse,
}: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [resetNotice, setResetNotice] = useState<{ message: string; prevType: MajorType; prevOptions: Options } | null>(null);

  const disabled = !hasResult;
  const normalizedQuery = query.toLowerCase().trim();
  const definitions = visibleDefs(chartType, options).filter(
    (definition) => !normalizedQuery
      || definition.label.toLowerCase().includes(normalizedQuery)
      || definition.section.toLowerCase().includes(normalizedQuery),
  );
  const typography = resolveChartTypography(options);

  const valueOf = (definition: OptionDef) => {
    if (definition.key === 'chartType') return chartType;
    const value = getPath(options, definition.key);
    return value === undefined ? defaultOf(definition, chartType) : value;
  };
  const setValue = (definition: OptionDef, value: unknown) => {
    const next = structuredClone(options);
    setPath(next, definition.key, value);
    onChangeOptions(next);
  };
  const setPaletteActiveIndex = (index: number) => {
    const next = structuredClone(options);
    setPath(next, 'paletteActiveIndex', index);
    onChangeOptions(next);
  };
  const changeType = (nextType: MajorType) => {
    if (nextType === chartType) return;
    const previousType = chartType;
    const previousOptions = structuredClone(options);
    const { next, removedKeys } = switchMajor(options, chartType, nextType);
    onChangeChartType(nextType, next);
    setResetNotice(removedKeys.length > 0
      ? { message: `${chartTypeLabel(previousType)} 전용 설정이 초기화되었습니다.`, prevType: previousType, prevOptions: previousOptions }
      : null);
  };
  const toggleSection = (key: string) => setCollapsed((previous) => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

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
        {resetNotice && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-text-secondary">
            <span>{resetNotice.message}</span>
            <button type="button" className="shrink-0 font-medium text-text-primary hover:underline" onClick={() => {
              onChangeChartType(resetNotice.prevType, resetNotice.prevOptions);
              setResetNotice(null);
            }}>
              실행 취소
            </button>
          </div>
        )}
      </div>

      {ZONE_ORDER.map((zone) => {
        const zoneDefinitions = definitions.filter((definition) => definition.zone === zone);
        if (zoneDefinitions.length === 0) return null;
        const sections = [...new Set(zoneDefinitions.map((definition) => definition.section))];
        return (
          <div key={zone}>
            <div className="flex items-center gap-2 px-4 pb-1 pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{ZONE_LABEL[zone]}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {sections.map((section) => {
              const sectionKey = `${zone}/${section}`;
              const open = !collapsed.has(sectionKey);
              const sectionDefinitions = zoneDefinitions.filter((definition) => definition.section === section);
              return (
                <section key={sectionKey} className="border-b border-border px-4 py-2.5">
                  <button type="button" onClick={() => toggleSection(sectionKey)} className="flex w-full items-center gap-1.5 text-left">
                    {open ? <ChevronDown className="size-3.5 text-text-secondary" /> : <ChevronRight className="size-3.5 text-text-secondary" />}
                    <span className="text-[13px] font-semibold text-text-primary">{section}</span>
                  </button>
                  {open && (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      {section === '글꼴' && <TypographyPolicy typography={typography} />}
                      {sectionDefinitions.map((definition) => definition.control === 'mapViewport' ? (
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
                          columns={columns}
                          hasResult={hasResult}
                          disabled={disabled}
                          paletteActiveIndex={coercePaletteIndex(options.paletteActiveIndex)}
                          onChange={(value) => setValue(definition, value)}
                          onChangeType={changeType}
                          onSelectPaletteIndex={setPaletteActiveIndex}
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
    </div>
  );
}
