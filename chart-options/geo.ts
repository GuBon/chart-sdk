/** 서버가 동적 지도 경계를 ECharts option과 함께 전달할 때 사용하는 내부 계약. */
export const EMBEDDED_MAPS_KEY = '__chartsdkMaps';
export const MAP_VIEWPORT_KEY = '__chartsdkMapViewport';

export type MapViewportMode = 'data' | 'regions' | 'manual' | 'coordinates';

export interface MapBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

export type MapViewport =
  | { mode: 'data' }
  | { mode: 'regions'; regionKeys: string[]; bounds?: MapBounds }
  | { mode: 'manual'; bounds?: MapBounds }
  | { mode: 'coordinates'; bounds?: MapBounds };

export const DEFAULT_MAP_VIEWPORT: MapViewport = { mode: 'data' };

export interface EmbeddedMap {
  name: string;
  geoJSON: Record<string, unknown>;
}

/** 저장값·구버전 옵션을 안전한 표시 영역 계약으로 정규화한다. */
export function normalizeMapViewport(value: unknown): MapViewport {
  if (!value || typeof value !== 'object') return DEFAULT_MAP_VIEWPORT;
  const raw = value as { mode?: unknown; regionKeys?: unknown; bounds?: unknown };
  const bounds = normalizeMapBounds(raw.bounds);
  if (raw.mode === 'regions') {
    const regionKeys = Array.isArray(raw.regionKeys)
      ? [...new Set(raw.regionKeys.filter((key): key is string => typeof key === 'string' && key.trim().length > 0).map((key) => key.trim()))]
      : [];
    return { mode: 'regions', regionKeys, ...(bounds ? { bounds } : {}) };
  }
  if (raw.mode === 'manual') return { mode: 'manual', ...(bounds ? { bounds } : {}) };
  if (raw.mode === 'coordinates') return { mode: 'coordinates', ...(bounds ? { bounds } : {}) };
  return DEFAULT_MAP_VIEWPORT;
}

export function normalizeMapBounds(value: unknown): MapBounds | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof MapBounds, unknown>>;
  const west = finiteCoordinate(raw.west);
  const east = finiteCoordinate(raw.east);
  const south = finiteCoordinate(raw.south);
  const north = finiteCoordinate(raw.north);
  if (![west, east, south, north].every(Number.isFinite)) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  if (west >= east || south >= north) return null;
  return { west, east, south, north };
}

function finiteCoordinate(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) return Number(value);
  return Number.NaN;
}

export function mapBoundsToBoundingCoords(bounds: MapBounds): [[number, number], [number, number]] {
  return [[bounds.west, bounds.north], [bounds.east, bounds.south]];
}

/**
 * 서버가 전달한 표시 영역 메타데이터를 실제 ECharts boundingCoords로 변환한다.
 * 내장 지도와 동적 Polygon은 등록된 GeoJSON에서, 지도 포인트는 series 데이터에서 경계를 계산한다.
 */
export function applyMapViewport(
  option: Record<string, unknown>,
  resolveMap: (name: string) => unknown,
): MapBounds | null {
  const viewport = takeMapViewport(option);
  if (!viewport) return null;

  const mapSeries = seriesOf(option).filter((series) => series.type === 'map');
  const geo = firstObject(option.geo);
  let bounds: MapBounds | null = null;
  let preserveExactBounds = false;

  if (viewport.mode === 'manual' || viewport.mode === 'coordinates') {
    bounds = viewport.bounds ?? null;
  } else if (mapSeries.length > 0) {
    const series = mapSeries[0];
    const mapName = typeof series.map === 'string' ? series.map : '';
    if (viewport.mode === 'regions' && viewport.regionKeys.length === 0 && viewport.bounds) {
      // 표시 방식만 바꾼 시점에는 아직 선택 지역이 없다. 기존 화면을 유지하고,
      // 첫 지역을 고른 순간부터 해당 지역의 경계를 계산한다.
      bounds = viewport.bounds;
      preserveExactBounds = true;
    } else {
      const names = viewport.mode === 'regions' ? viewport.regionKeys : mapDataNames(series.data);
      bounds = boundsFromRegisteredMap(resolveMap(mapName), names);
      if (!bounds && viewport.mode === 'regions') bounds = viewport.bounds ?? null;
    }
  } else if (geo) {
    bounds = boundsFromGeoSeries(option);
  }

  if (bounds && !preserveExactBounds && (viewport.mode === 'data' || viewport.mode === 'regions')) bounds = padMapBounds(bounds);
  const boundingCoords = bounds ? mapBoundsToBoundingCoords(bounds) : null;
  for (const series of mapSeries) {
    if (boundingCoords) series.boundingCoords = boundingCoords;
    else delete series.boundingCoords;
  }
  if (geo) {
    if (boundingCoords) geo.boundingCoords = boundingCoords;
    else delete geo.boundingCoords;
  }
  return bounds;
}

/**
 * ECharts가 알지 못하는 내부 메타데이터를 option에서 꺼낸다.
 * 호출자는 반환된 지도를 registerMap 한 뒤 정리된 option만 setOption에 전달해야 한다.
 */
export function takeEmbeddedMaps(option: Record<string, unknown>): EmbeddedMap[] {
  const raw = option[EMBEDDED_MAPS_KEY];
  delete option[EMBEDDED_MAPS_KEY];
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is EmbeddedMap => {
    if (!item || typeof item !== 'object') return false;
    const map = item as { name?: unknown; geoJSON?: unknown };
    return typeof map.name === 'string'
      && map.name.length > 0
      && !!map.geoJSON
      && typeof map.geoJSON === 'object';
  });
}

/** ECharts에 넘기면 안 되는 표시 영역 메타데이터를 꺼내고 제거한다. */
export function takeMapViewport(option: Record<string, unknown>): MapViewport | null {
  if (!(MAP_VIEWPORT_KEY in option)) return null;
  const raw = option[MAP_VIEWPORT_KEY];
  delete option[MAP_VIEWPORT_KEY];
  return normalizeMapViewport(raw);
}

function seriesOf(option: Record<string, unknown>): Record<string, any>[] {
  const raw = option.series;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((item): item is Record<string, any> => !!item && typeof item === 'object');
}

function firstObject(value: unknown): Record<string, any> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' ? candidate as Record<string, any> : null;
}

function mapDataNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const name = (item as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? [name.trim()] : [];
  }))];
}

function boundsFromGeoSeries(option: Record<string, unknown>): MapBounds | null {
  const acc = emptyBounds();
  for (const series of seriesOf(option)) {
    if (series.coordinateSystem !== 'geo' || !Array.isArray(series.data)) continue;
    for (const item of series.data) {
      const value = Array.isArray(item)
        ? item
        : item && typeof item === 'object' && Array.isArray((item as { value?: unknown }).value)
          ? (item as { value: unknown[] }).value
          : null;
      if (value) includeCoordinate(acc, value);
    }
  }
  return finishBounds(acc, 0.5);
}

function boundsFromRegisteredMap(source: unknown, names: string[]): MapBounds | null {
  const geoJSON = unwrapGeoJSON(source);
  if (!geoJSON || !Array.isArray(geoJSON.features)) return null;
  const selected = new Set(names);
  const acc = emptyBounds();
  for (const feature of geoJSON.features) {
    if (!feature || typeof feature !== 'object') continue;
    const record = feature as { properties?: Record<string, unknown>; geometry?: unknown };
    const name = record.properties?.name;
    if (selected.size > 0 && (typeof name !== 'string' || !selected.has(name))) continue;
    visitCoordinates((record.geometry as { coordinates?: unknown } | null)?.coordinates, acc);
  }
  return finishBounds(acc, 0.02);
}

function unwrapGeoJSON(source: unknown): { features?: unknown[] } | null {
  if (!source || typeof source !== 'object') return null;
  const record = source as Record<string, unknown>;
  if (Array.isArray(record.features)) return record as { features: unknown[] };
  const nested = record.geoJSON ?? record.geoJson;
  return nested && typeof nested === 'object' ? nested as { features?: unknown[] } : null;
}

type BoundsAccumulator = { west: number; east: number; south: number; north: number; count: number };

function emptyBounds(): BoundsAccumulator {
  return { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity, count: 0 };
}

function includeCoordinate(acc: BoundsAccumulator, value: unknown[]): void {
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return;
  acc.west = Math.min(acc.west, longitude);
  acc.east = Math.max(acc.east, longitude);
  acc.south = Math.min(acc.south, latitude);
  acc.north = Math.max(acc.north, latitude);
  acc.count += 1;
}

function visitCoordinates(value: unknown, acc: BoundsAccumulator): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    includeCoordinate(acc, value);
    return;
  }
  for (const child of value) visitCoordinates(child, acc);
}

function finishBounds(acc: BoundsAccumulator, minimumSpan: number): MapBounds | null {
  if (acc.count === 0) return null;
  let { west, east, south, north } = acc;
  if (east - west < minimumSpan) {
    const center = (west + east) / 2;
    west = center - minimumSpan / 2;
    east = center + minimumSpan / 2;
  }
  if (north - south < minimumSpan) {
    const center = (south + north) / 2;
    south = center - minimumSpan / 2;
    north = center + minimumSpan / 2;
  }
  return normalizeMapBounds({ west, east, south, north });
}

function padMapBounds(bounds: MapBounds): MapBounds {
  const longitudePadding = Math.max(0.02, (bounds.east - bounds.west) * 0.08);
  const latitudePadding = Math.max(0.02, (bounds.north - bounds.south) * 0.08);
  return {
    west: Math.max(-180, bounds.west - longitudePadding),
    east: Math.min(180, bounds.east + longitudePadding),
    south: Math.max(-90, bounds.south - latitudePadding),
    north: Math.min(90, bounds.north + latitudePadding),
  };
}
