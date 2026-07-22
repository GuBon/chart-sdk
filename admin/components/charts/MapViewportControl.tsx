'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Crosshair, Search } from 'lucide-react';
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
import { cn } from '@/lib/cn';

interface Props {
  chartType: MajorType;
  value: unknown;
  regionNames: string[];
  disabled: boolean;
  editing: boolean;
  currentBounds: MapBounds | null;
  onChange: (viewport: MapViewport) => void;
  onEditingChange: (editing: boolean) => void;
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
  value,
  regionNames,
  disabled,
  editing,
  currentBounds,
  onChange,
  onEditingChange,
}: Props) {
  const viewport = normalizeMapViewport(value);
  const modes: MapViewportMode[] = chartType === 'map'
    ? ['data', 'regions', 'manual', 'coordinates']
    : ['data', 'manual', 'coordinates'];
  const uniqueRegions = useMemo(
    () => [...new Set(regionNames.map((name) => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [regionNames],
  );
  const viewportBounds = 'bounds' in viewport ? viewport.bounds : undefined;
  const viewportWest = viewportBounds?.west;
  const viewportEast = viewportBounds?.east;
  const viewportSouth = viewportBounds?.south;
  const viewportNorth = viewportBounds?.north;
  const [regionQuery, setRegionQuery] = useState('');
  const [coordinates, setCoordinates] = useState<CoordinateDraft>(() => coordinateDraft(viewportBounds));

  useEffect(() => {
    if (viewport.mode !== 'coordinates') return;
    const bounds = normalizeMapBounds({ west: viewportWest, east: viewportEast, south: viewportSouth, north: viewportNorth });
    setCoordinates(coordinateDraft(bounds ?? undefined));
  }, [viewport.mode, viewportEast, viewportNorth, viewportSouth, viewportWest]);

  const selectMode = (mode: MapViewportMode) => {
    onEditingChange(false);
    if (mode === 'data') onChange({ mode: 'data' });
    if (mode === 'regions') onChange(viewport.mode === 'regions' ? viewport : { mode: 'regions', regionKeys: [] });
    if (mode === 'manual') onChange(viewport.mode === 'manual' ? viewport : { mode: 'manual' });
    if (mode === 'coordinates') onChange(viewport.mode === 'coordinates' ? viewport : { mode: 'coordinates' });
  };

  const selectedRegions = viewport.mode === 'regions' ? viewport.regionKeys : [];
  const filteredRegions = uniqueRegions.filter((name) => name.toLocaleLowerCase('ko').includes(regionQuery.trim().toLocaleLowerCase('ko')));
  const unavailableRegions = selectedRegions.filter((name) => !uniqueRegions.includes(name));
  const coordinateBounds = normalizeMapBounds(coordinates);

  const toggleRegion = (name: string) => {
    const next = selectedRegions.includes(name)
      ? selectedRegions.filter((region) => region !== name)
      : [...selectedRegions, name];
    onChange({ mode: 'regions', regionKeys: next });
  };

  const useCurrentBounds = () => {
    if (!currentBounds) return;
    setCoordinates(coordinateDraft(currentBounds));
  };

  return (
    <div data-testid="map-viewport-control" className={cn('flex flex-col gap-3 rounded-md border border-border p-3', disabled && 'pointer-events-none opacity-50')}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-text-primary">표시 영역</span>
          <span className="text-[11px] text-text-tertiary">초기 화면</span>
        </div>
        <div role="radiogroup" aria-label="지도 표시 영역" className="mt-2 grid grid-cols-2 gap-1.5">
          {modes.map((mode) => {
            const active = viewport.mode === mode;
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

      {viewport.mode === 'data' && (
        <p className="text-[11px] leading-4 text-text-tertiary">현재 데이터가 모두 들어오도록 영역을 자동으로 맞춥니다. 데이터가 바뀌면 영역도 다시 계산됩니다.</p>
      )}

      {viewport.mode === 'regions' && (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="지도 지역 검색"
            icon={<Search className="size-3.5" />}
            size="sm"
            value={regionQuery}
            onChange={(event) => setRegionQuery(event.target.value)}
            placeholder="현재 데이터의 지역 검색"
          />
          <div className="max-h-40 overflow-y-auto rounded border border-border bg-bg-panel p-1">
            {filteredRegions.length > 0 ? filteredRegions.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-text-secondary hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selectedRegions.includes(name)}
                  onChange={() => toggleRegion(name)}
                  className="size-3.5 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate">{name}</span>
              </label>
            )) : (
              <p className="px-2 py-3 text-center text-xs text-text-tertiary">선택할 수 있는 Polygon 지역이 없습니다.</p>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary">{selectedRegions.length > 0 ? `${selectedRegions.length}개 지역 선택됨` : '한 개 이상의 지역을 선택하세요.'}</p>
          {unavailableRegions.length > 0 && (
            <div className="flex items-start gap-2 rounded bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-text-secondary">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p>저장된 지역 중 현재 데이터에 없는 지역이 있습니다: {unavailableRegions.join(', ')}</p>
                <button type="button" onClick={() => onChange({ mode: 'data' })} className="mt-1 font-medium text-text-primary hover:underline">데이터 전체로 전환</button>
              </div>
            </div>
          )}
        </div>
      )}

      {viewport.mode === 'manual' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-4 text-text-tertiary">
            {editing
              ? '미리보기 지도를 드래그하거나 휠로 확대·축소한 뒤 현재 영역을 적용하세요.'
              : '미리보기 지도는 언제든 드래그·휠로 조정할 수 있습니다. 현재 화면을 저장하려면 지도 조정을 시작하세요.'}
          </p>
          {viewport.bounds && !editing && <BoundsSummary bounds={viewport.bounds} />}
          {editing ? (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" onClick={() => onEditingChange(false)}>초기화</Button>
              <Button size="sm" className="h-7 px-2.5 text-xs" disabled={!currentBounds} onClick={() => {
                if (!currentBounds) return;
                onChange({ mode: 'manual', bounds: currentBounds });
                onEditingChange(false);
              }}>
                현재 지도 영역 적용
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" className="h-8 w-full text-xs" icon={<Crosshair className="size-3.5" />} onClick={() => onEditingChange(true)}>
              지도 조정 시작
            </Button>
          )}
        </div>
      )}

      {viewport.mode === 'coordinates' && (
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <CoordinateInput label="서쪽 경도" value={coordinates.west} min={-180} max={180} onChange={(west) => setCoordinates((current) => ({ ...current, west }))} />
            <CoordinateInput label="동쪽 경도" value={coordinates.east} min={-180} max={180} onChange={(east) => setCoordinates((current) => ({ ...current, east }))} />
            <CoordinateInput label="남쪽 위도" value={coordinates.south} min={-90} max={90} onChange={(south) => setCoordinates((current) => ({ ...current, south }))} />
            <CoordinateInput label="북쪽 위도" value={coordinates.north} min={-90} max={90} onChange={(north) => setCoordinates((current) => ({ ...current, north }))} />
          </div>
          <p className={cn('text-[11px] leading-4', coordinateBounds ? 'text-text-tertiary' : 'text-danger')}>
            {coordinateBounds ? 'WGS84 경계 좌표를 사용합니다.' : '서쪽 < 동쪽, 남쪽 < 북쪽 범위의 올바른 좌표를 입력하세요.'}
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" disabled={!currentBounds} onClick={useCurrentBounds}>현재 화면 좌표 가져오기</Button>
            <Button size="sm" className="h-7 px-2.5 text-xs" disabled={!coordinateBounds} onClick={() => {
              if (coordinateBounds) onChange({ mode: 'coordinates', bounds: coordinateBounds });
            }}>적용</Button>
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
    <p className="rounded bg-muted px-2.5 py-2 font-mono text-[10px] leading-4 text-text-tertiary">
      W {formatCoordinate(bounds.west)} · E {formatCoordinate(bounds.east)}<br />
      S {formatCoordinate(bounds.south)} · N {formatCoordinate(bounds.north)}
    </p>
  );
}
