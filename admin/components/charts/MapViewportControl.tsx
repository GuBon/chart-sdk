'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import {
  normalizeMapBounds,
  normalizeMapViewport,
  type MapBounds,
  type MapViewport,
  type MapViewportMode,
} from '@chartsdk/chart-options/geo';
import type { MajorType } from '@chartsdk/chart-options';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import {
  administrativeRegionOptions,
  administrativeRegionSelectionFromViewport,
  mapViewportForAdministrativeSelection,
  type AdministrativeRegionSelection,
} from '@/lib/koreaAdministrativeRegions';
import type { MapViewportSession } from '@/lib/mapViewportSession';

interface Props {
  chartType: MajorType;
  session: MapViewportSession;
  disabled: boolean;
  onChange: (viewport: MapViewport) => void;
  onSelectMode: (mode: MapViewportMode) => void;
  canSave: boolean;
  canReset: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}

const MODE_LABELS: Record<MapViewportMode, string> = {
  data: '데이터 전체',
  regions: '지역 선택',
  manual: '지도에서 조정',
  coordinates: '좌표로 지정',
};

type CoordinateDraft = Record<keyof MapBounds, string>;

export function MapViewportControl({
  chartType,
  session,
  disabled,
  onChange,
  onSelectMode,
  canSave,
  canReset,
  saving,
  onSave,
  onReset,
}: Props) {
  const viewport = normalizeMapViewport(session.draft);
  const activeMode = session.activePanel;
  const currentBounds = session.visibleBounds;
  const editing = session.editing;
  // 영역 지도와 포인트 지도 모두 같은 행정구역 표시 범위 계약을 사용한다.
  // 포인트 지도도 배경 geo가 동일한 대한민국 경계를 사용하므로 지역 선택을 숨길 이유가 없다.
  const modes: MapViewportMode[] = chartType === 'map' || chartType === 'geoscatter'
    ? ['data', 'regions', 'manual', 'coordinates']
    : ['data', 'manual', 'coordinates'];
  const viewportBounds = 'bounds' in viewport ? viewport.bounds : undefined;
  const viewportWest = viewportBounds?.west;
  const viewportEast = viewportBounds?.east;
  const viewportSouth = viewportBounds?.south;
  const viewportNorth = viewportBounds?.north;
  const [coordinates, setCoordinates] = useState<CoordinateDraft>(() => coordinateDraft(viewportBounds));

  useEffect(() => {
    if (viewport.mode !== 'coordinates') return;
    const bounds = normalizeMapBounds({ west: viewportWest, east: viewportEast, south: viewportSouth, north: viewportNorth });
    setCoordinates(coordinateDraft(bounds ?? undefined));
  }, [viewport.mode, viewportEast, viewportNorth, viewportSouth, viewportWest]);

  const selectMode = (mode: MapViewportMode) => {
    if (mode === 'coordinates' && currentBounds) setCoordinates(coordinateDraft(currentBounds));
    onSelectMode(mode);
  };

  const administrativeSelection = administrativeRegionSelectionFromViewport(viewport);
  const regionOptions = administrativeRegionOptions(administrativeSelection);
  const coordinateBounds = normalizeMapBounds(coordinates);

  const changeAdministrativeRegion = (next: AdministrativeRegionSelection) => {
    onChange(mapViewportForAdministrativeSelection(next));
  };

  return (
    <div data-testid="map-viewport-control" className={cn('flex flex-col gap-3 rounded-md border border-border p-3', disabled && 'pointer-events-none opacity-50')}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-text-primary">표시 영역</span>
          <div data-testid="map-viewport-actions" className="inline-flex overflow-hidden rounded-md border border-border bg-bg-panel">
            <button
              type="button"
              disabled={!canReset || saving}
              title="지도 영역만 마지막 영역 저장 상태로 복원"
              onClick={onReset}
              className="h-6 border-r border-border px-2 text-[11px] font-medium text-text-secondary hover:bg-muted hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
            >
              초기화
            </button>
            <button
              type="button"
              disabled={!canSave || saving}
              title="현재 지도 영역만 임시 저장"
              onClick={onSave}
              className="h-6 bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
        <div role="radiogroup" aria-label="지도 표시 영역" className="mt-2 grid grid-cols-2 gap-1.5">
          {modes.map((mode) => {
            const active = activeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => selectMode(mode)}
                className={cn(
                  'flex min-h-8 items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs transition-colors',
                  active ? 'border-primary bg-muted font-medium text-text-primary' : 'border-border text-text-secondary hover:bg-muted',
                )}
              >
                <span className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-full border', active ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                  {active && <Check className="size-2.5" />}
                </span>
                {MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
      </div>

      {activeMode === 'data' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-4 text-text-tertiary">
            현재 데이터가 모두 들어오도록 영역을 자동으로 맞춥니다. 이 방식을 선택하는 것만으로 지도는 이동하지 않습니다.
          </p>
          <Button size="sm" className="h-8 w-full text-xs" onClick={() => onChange({ mode: 'data' })}>
            데이터 범위에 맞춤
          </Button>
        </div>
      )}

      {activeMode === 'regions' && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-4 gap-1.5">
            <div className="min-w-0">
              <Select
                aria-label="시/도"
                value={administrativeSelection.province}
                placeholder="시/도"
                options={regionOptions.provinces}
                onChange={(event) => changeAdministrativeRegion({
                  province: event.target.value,
                  city: '',
                  county: '',
                  district: '',
                })}
                className="min-w-0 px-2 pr-6 text-xs"
              />
            </div>
            <div className="min-w-0">
              <Select
                aria-label="시"
                value={administrativeSelection.city}
                placeholder="시"
                options={regionOptions.cities}
                disabled={!administrativeSelection.province || regionOptions.cities.length === 0}
                onChange={(event) => changeAdministrativeRegion({
                  ...administrativeSelection,
                  city: event.target.value,
                  county: '',
                  district: '',
                })}
                className="min-w-0 px-2 pr-6 text-xs"
              />
            </div>
            <div className="min-w-0">
              <Select
                aria-label="군"
                value={administrativeSelection.county}
                placeholder="군"
                options={regionOptions.counties}
                disabled={!administrativeSelection.province || regionOptions.counties.length === 0}
                onChange={(event) => changeAdministrativeRegion({
                  ...administrativeSelection,
                  city: '',
                  county: event.target.value,
                  district: '',
                })}
                className="min-w-0 px-2 pr-6 text-xs"
              />
            </div>
            <div className="min-w-0">
              <Select
                aria-label="구"
                value={administrativeSelection.district}
                placeholder="구"
                options={regionOptions.districts}
                disabled={!administrativeSelection.province || regionOptions.districts.length === 0}
                onChange={(event) => changeAdministrativeRegion({
                  ...administrativeSelection,
                  county: '',
                  district: event.target.value,
                })}
                className="min-w-0 px-2 pr-6 text-xs"
              />
            </div>
          </div>
          <p className="text-[11px] leading-4 text-text-tertiary">
            시/도를 선택한 뒤 필요한 하위 행정구역을 선택하세요. 비워 두면 선택한 상위 지역 전체를 표시합니다.
          </p>
        </div>
      )}

      {activeMode === 'manual' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-4 text-text-tertiary">
            이 패널을 선택한 동안에는 드래그·휠이 저장할 영역을 조정합니다. 다른 패널에서는 지도 이동이 단순 탐색으로만 동작합니다.
          </p>
          <p className="text-[11px] leading-4 text-text-tertiary">
            지도 위에서 Shift+드래그하면 사각형 범위를 한 번에 지정할 수 있습니다.
          </p>
          {(currentBounds ?? viewportBounds) && <BoundsSummary bounds={(currentBounds ?? viewportBounds)!} />}
          {editing ? (
            <p className="text-[11px] font-medium text-primary">현재 영역을 조정 중입니다.</p>
          ) : (
            <Button size="sm" className="h-8 w-full text-xs" onClick={() => onSelectMode('manual')}>
              현재 화면에서 영역 조정 시작
            </Button>
          )}
        </div>
      )}

      {activeMode === 'coordinates' && (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <CoordinateInput label="서쪽 경도" value={coordinates.west} min={-180} max={180} onChange={(west) => setCoordinates((current) => ({ ...current, west }))} />
            <CoordinateInput label="동쪽 경도" value={coordinates.east} min={-180} max={180} onChange={(east) => setCoordinates((current) => ({ ...current, east }))} />
            <CoordinateInput label="남쪽 위도" value={coordinates.south} min={-90} max={90} onChange={(south) => setCoordinates((current) => ({ ...current, south }))} />
            <CoordinateInput label="북쪽 위도" value={coordinates.north} min={-90} max={90} onChange={(north) => setCoordinates((current) => ({ ...current, north }))} />
          </div>
          <p className={cn('text-[11px] leading-4', coordinateBounds ? 'text-text-tertiary' : 'text-danger')}>
            {coordinateBounds
              ? '입력한 WGS84 경계로 지도를 이동한 뒤 영역 저장으로 확정하세요.'
              : '서쪽 < 동쪽, 남쪽 < 북쪽 범위의 올바른 좌표를 입력하세요.'}
          </p>
          <div className="flex justify-end">
            <Button size="sm" className="h-8 w-full text-xs" disabled={!coordinateBounds} onClick={() => {
              if (coordinateBounds) onChange({ mode: 'coordinates', bounds: coordinateBounds });
            }}>좌표로 이동</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function mapViewportStatus(value: unknown): string {
  const viewport = normalizeMapViewport(value);
  if (viewport.mode === 'regions') return viewport.regionKeys.length > 0 ? `${viewport.regionKeys[0]}${viewport.regionKeys.length > 1 ? ` 외 ${viewport.regionKeys.length - 1}개` : ''}` : '지역을 선택하세요';
  if (viewport.mode === 'manual') return viewport.bounds ? '사용자 지정' : '지도 조정 필요';
  if (viewport.mode === 'coordinates') return viewport.bounds ? '좌표 지정' : '좌표 입력 필요';
  return '데이터 전체';
}

function coordinateDraft(bounds?: MapBounds): CoordinateDraft {
  return {
    west: bounds ? formatCoordinate(bounds.west) : '',
    east: bounds ? formatCoordinate(bounds.east) : '',
    south: bounds ? formatCoordinate(bounds.south) : '',
    north: bounds ? formatCoordinate(bounds.north) : '',
  };
}

function formatCoordinate(value: number): string {
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function CoordinateInput({ label, value, min, max, onChange }: { label: string; value: string; min: number; max: number; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      <span>{label}</span>
      <Input aria-label={label} size="sm" type="number" step="0.000001" min={min} max={max} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function BoundsSummary({ bounds }: { bounds: MapBounds }) {
  return (
    <p data-testid="map-bounds-summary" className="rounded bg-muted px-2.5 py-2 font-mono text-[10px] leading-4 text-text-tertiary">
      W {formatCoordinate(bounds.west)} · E {formatCoordinate(bounds.east)}<br />
      S {formatCoordinate(bounds.south)} · N {formatCoordinate(bounds.north)}
    </p>
  );
}
