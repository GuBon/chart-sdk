'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { MajorType } from '@chartsdk/chart-options';
import krSido from '@chartsdk/chart-options/maps/kr-sido.json';
import krSigungu from '@chartsdk/chart-options/maps/kr-sigungu.json';
import {
  applyMapViewport,
  MAP_VIEWPORT_KEY,
  normalizeMapBounds,
  takeEmbeddedMaps,
  type MapBounds,
  type MapViewport,
} from '@chartsdk/chart-options/geo';
import { hasChartTitle, responsiveTitlePatch, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';

export type MapBoundsChangeSource = 'sync' | 'roam' | 'box';

interface Point {
  x: number;
  y: number;
}

interface BoxDrag {
  pointerId: number;
  start: Point;
  current: Point;
  startClient: Point;
  currentClient: Point;
}

// 지도(map·geoscatter) 차트용 GeoJSON 등록 — 모듈 로드 시 1회. registerMap 은 DOM 불요라 SSR 안전.
// 미리보기(에디터)와 S1 썸네일(MiniChart)이 이 컴포넌트를 공유하므로 여기서 등록하면 양쪽 모두 커버.
echarts.registerMap('kr-sido', krSido as never);
echarts.registerMap('kr-sigungu', krSigungu as never);

// S2 우측 상단 차트 미리보기. 서버(목 변환기)가 조립한 ECharts option 을 setOption 만 한다.
// (방식 A — 클라이언트는 모양을 결정하지 않는다. SDK 와 동일 규약.)
export function ChartPreview({
  option,
  chartType = 'bar',
  mapViewportEditing = false,
  mapViewport,
  mapViewportRevision = 0,
  mapBoxZoomEnabled = true,
  onMapBoundsChange,
}: {
  option: Record<string, unknown> | null;
  chartType?: MajorType;
  mapViewportEditing?: boolean;
  mapViewport?: MapViewport;
  mapViewportRevision?: number;
  mapBoxZoomEnabled?: boolean;
  onMapBoundsChange?: (bounds: MapBounds | null, source: MapBoundsChangeSource) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const hasTitleRef = useRef(false);
  const hasRenderedRef = useRef(false);
  const renderedMapViewportRevisionRef = useRef<number | null>(null);
  const onMapBoundsChangeRef = useRef(onMapBoundsChange);
  const mapViewportRef = useRef(mapViewport);
  const roamFrameRef = useRef<number | null>(null);
  const shiftPressedRef = useRef(false);
  const boxDragRef = useRef<BoxDrag | null>(null);
  const [boxZoomArmed, setBoxZoomArmed] = useState(false);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);

  useEffect(() => {
    onMapBoundsChangeRef.current = onMapBoundsChange;
  }, [onMapBoundsChange]);

  useEffect(() => {
    mapViewportRef.current = mapViewport;
  }, [mapViewport]);

  useEffect(() => {
    if (!elRef.current) return;
    const el = elRef.current;
    const chart = echarts.init(el);
    chartRef.current = chart;
    const reportMapBounds = (source: MapBoundsChangeSource) => {
      const bounds = visibleMapBounds(chart);
      onMapBoundsChangeRef.current?.(bounds, source);
    };
    const reportRoamedMapBounds = () => {
      if (boxDragRef.current || roamFrameRef.current != null) return;
      roamFrameRef.current = window.requestAnimationFrame(() => {
        roamFrameRef.current = null;
        reportMapBounds('roam');
      });
    };
    chart.on('georoam', reportRoamedMapBounds);
    const ro = new ResizeObserver(() => {
      chart.resize();
      if (hasTitleRef.current) chart.setOption(responsiveTitlePatch(el.clientWidth));
      reportMapBounds('sync');
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (roamFrameRef.current != null) cancelAnimationFrame(roamFrameRef.current);
      chart.off('georoam', reportRoamedMapBounds);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!chart || !el) return;
    if (option) {
      const isMapChart = chartType === 'map' || chartType === 'geoscatter';
      const preserveCurrentCamera = isMapChart
        && hasRenderedRef.current
        && renderedMapViewportRevisionRef.current === mapViewportRevision;
      const mapCamera = preserveCurrentCamera ? currentMapCamera(chart) : null;
      const renderOption = structuredClone(option);
      for (const embedded of takeEmbeddedMaps(renderOption)) {
        if (!echarts.getMap(embedded.name)) echarts.registerMap(embedded.name, embedded.geoJSON as never);
      }
      const activeMapViewport = mapViewportRef.current;
      if ((chartType === 'map' || chartType === 'geoscatter') && activeMapViewport) {
        renderOption[MAP_VIEWPORT_KEY] = structuredClone(activeMapViewport);
      }
      applyMapViewport(renderOption, (name) => echarts.getMap(name));
      // Admin 미리보기는 저장 옵션의 roam 여부와 무관하게 탐색 가능해야 한다.
      // 임베드/최종 차트의 인터랙션 여부는 기존 map.roam 옵션을 계속 따른다.
      enableMapRoam(renderOption);
      if (mapCamera) applyMapCamera(renderOption, mapCamera);
      hasTitleRef.current = hasChartTitle(renderOption);
      chart.setOption(withResponsiveTitle(renderOption, el.clientWidth), true);
      hasRenderedRef.current = true;
      renderedMapViewportRevisionRef.current = mapViewportRevision;
      requestAnimationFrame(() => onMapBoundsChangeRef.current?.(visibleMapBounds(chart), 'sync'));
    } else {
      hasTitleRef.current = false;
      hasRenderedRef.current = false;
      renderedMapViewportRevisionRef.current = null;
      chart.clear();
      onMapBoundsChangeRef.current?.(null, 'sync');
    }
  }, [chartType, mapViewportRevision, option]);

  useEffect(() => {
    if (!mapViewportEditing) return;
    const chart = chartRef.current;
    if (!chart) return;
    // 지도 조정 모드 진입 시 setOption으로 사용자가 이미 맞춘 위치를 초기화하지 않고
    // 현재 화면만 다시 보고한다. 실제 저장은 편집기 상단의 전역 저장 버튼이 담당한다.
    const frame = requestAnimationFrame(() => onMapBoundsChangeRef.current?.(visibleMapBounds(chart), 'sync'));
    return () => cancelAnimationFrame(frame);
  }, [mapViewportEditing]);

  useEffect(() => {
    const isMap = mapBoxZoomEnabled && (chartType === 'map' || chartType === 'geoscatter');
    if (!isMap) {
      shiftPressedRef.current = false;
      boxDragRef.current = null;
      setBoxZoomArmed(false);
      setBoxDrag(null);
      return;
    }

    const cancelBox = () => {
      boxDragRef.current = null;
      setBoxDrag(null);
      setBoxZoomArmed(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        shiftPressedRef.current = true;
        setBoxZoomArmed(true);
        return;
      }
      if (event.key === 'Escape' && boxDragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        cancelBox();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Shift') return;
      shiftPressedRef.current = false;
      if (!boxDragRef.current) setBoxZoomArmed(false);
    };
    const onBlur = () => {
      shiftPressedRef.current = false;
      cancelBox();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [chartType, mapBoxZoomEnabled]);

  const beginBoxDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!chart || !el || event.button !== 0 || !boxZoomArmed) return;
    const start = chartPointFromClient(chart, el, event.clientX, event.clientY);
    if (!start) return;
    const drag: BoxDrag = {
      pointerId: event.pointerId,
      start,
      current: start,
      startClient: { x: event.clientX, y: event.clientY },
      currentClient: { x: event.clientX, y: event.clientY },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    boxDragRef.current = drag;
    setBoxDrag(drag);
  };

  const moveBoxDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = boxDragRef.current;
    const chart = chartRef.current;
    const el = elRef.current;
    if (!current || current.pointerId !== event.pointerId || !chart || !el) return;
    const point = chartPointFromClient(chart, el, event.clientX, event.clientY);
    if (!point) return;
    const next: BoxDrag = {
      ...current,
      current: point,
      currentClient: { x: event.clientX, y: event.clientY },
    };
    event.preventDefault();
    boxDragRef.current = next;
    setBoxDrag(next);
  };

  const finishBoxDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = boxDragRef.current;
    const chart = chartRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !chart) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    boxDragRef.current = null;
    setBoxDrag(null);
    setBoxZoomArmed(shiftPressedRef.current);

    const screenWidth = Math.abs(drag.currentClient.x - drag.startClient.x);
    const screenHeight = Math.abs(drag.currentClient.y - drag.startClient.y);
    if (screenWidth < 12 || screenHeight < 12) return;
    const bounds = selectedMapBounds(chart, drag.start, drag.current);
    if (bounds) onMapBoundsChangeRef.current?.(bounds, 'box');
  };

  const cancelPointerBoxDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (boxDragRef.current?.pointerId !== event.pointerId) return;
    boxDragRef.current = null;
    setBoxDrag(null);
    setBoxZoomArmed(shiftPressedRef.current);
  };

  const selectionStyle = boxDrag ? {
    left: Math.min(boxDrag.start.x, boxDrag.current.x),
    top: Math.min(boxDrag.start.y, boxDrag.current.y),
    width: Math.abs(boxDrag.current.x - boxDrag.start.x),
    height: Math.abs(boxDrag.current.y - boxDrag.start.y),
  } : null;

  return (
    <div
      data-testid="chart-preview"
      data-map-viewport-editing={mapViewportEditing}
      data-box-zoom-armed={boxZoomArmed}
      className="relative h-full w-full"
    >
      <div ref={elRef} className="absolute inset-0" />
      {boxZoomArmed && (
        <div
          data-testid="map-box-zoom-overlay"
          className="absolute inset-0 z-20 cursor-crosshair touch-none select-none"
          onPointerDown={beginBoxDrag}
          onPointerMove={moveBoxDrag}
          onPointerUp={finishBoxDrag}
          onPointerCancel={cancelPointerBoxDrag}
        >
          {!boxDrag && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-white shadow">
              드래그하여 저장할 지도 영역 지정
            </div>
          )}
          {selectionStyle && (
            <div
              data-testid="map-box-zoom-selection"
              className="pointer-events-none absolute border-2 border-primary bg-primary/15"
              style={selectionStyle}
            />
          )}
        </div>
      )}
    </div>
  );
}

function enableMapRoam(option: Record<string, unknown>): void {
  const geo = option.geo;
  for (const item of Array.isArray(geo) ? geo : geo ? [geo] : []) {
    if (item && typeof item === 'object') (item as Record<string, unknown>).roam = true;
  }
  const series = option.series;
  for (const item of Array.isArray(series) ? series : series ? [series] : []) {
    if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'map') {
      (item as Record<string, unknown>).roam = true;
    }
  }
}

interface MapCamera {
  geo: { center?: unknown; zoom?: unknown; boundingCoords?: unknown }[];
  mapSeries: { center?: unknown; zoom?: unknown; boundingCoords?: unknown }[];
}

/**
 * 일반 옵션 변경으로 서버 미리보기가 다시 만들어질 때 현재 탐색 카메라를 보존한다.
 * 표시 영역 적용·초기화처럼 revision이 증가한 경우에는 저장 초안을 새 카메라로 적용한다.
 */
function currentMapCamera(chart: echarts.ECharts): MapCamera | null {
  const option = chart.getOption() as Record<string, unknown> | null | undefined;
  if (!option) return null;
  const geo = asObjects(option.geo).map(pickMapCamera);
  const mapSeries = asObjects(option.series)
    .filter((series) => series.type === 'map')
    .map(pickMapCamera);
  return geo.length > 0 || mapSeries.length > 0 ? { geo, mapSeries } : null;
}

function applyMapCamera(option: Record<string, unknown>, camera: MapCamera): void {
  asObjects(option.geo).forEach((geo, index) => assignMapCamera(geo, camera.geo[index]));
  asObjects(option.series)
    .filter((series) => series.type === 'map')
    .forEach((series, index) => assignMapCamera(series, camera.mapSeries[index]));
}

function pickMapCamera(source: Record<string, unknown>): {
  center?: unknown;
  zoom?: unknown;
  boundingCoords?: unknown;
} {
  return {
    ...(Array.isArray(source.center) ? { center: structuredClone(source.center) } : {}),
    ...(typeof source.zoom === 'number' && Number.isFinite(source.zoom) ? { zoom: source.zoom } : {}),
    ...(Array.isArray(source.boundingCoords) ? { boundingCoords: structuredClone(source.boundingCoords) } : {}),
  };
}

function assignMapCamera(
  target: Record<string, unknown>,
  camera: { center?: unknown; zoom?: unknown; boundingCoords?: unknown } | undefined,
): void {
  if (!camera) return;
  if (Array.isArray(camera.center)) target.center = structuredClone(camera.center);
  if (typeof camera.zoom === 'number' && Number.isFinite(camera.zoom)) target.zoom = camera.zoom;
  if (Array.isArray(camera.boundingCoords)) target.boundingCoords = structuredClone(camera.boundingCoords);
}

function asObjects(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item));
}

function chartPointFromClient(
  chart: echarts.ECharts,
  element: HTMLElement,
  clientX: number,
  clientY: number,
): Point | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(chart.getWidth(), (clientX - rect.left) * chart.getWidth() / rect.width)),
    y: Math.max(0, Math.min(chart.getHeight(), (clientY - rect.top) * chart.getHeight() / rect.height)),
  };
}

function selectedMapBounds(chart: echarts.ECharts, start: Point, end: Point): MapBounds | null {
  const finder = mapCoordinateFinder(chart);
  if (!finder) return null;
  try {
    const first = chart.convertFromPixel(finder, [start.x, start.y]);
    const second = chart.convertFromPixel(finder, [end.x, end.y]);
    if (!Array.isArray(first) || !Array.isArray(second)) return null;
    return normalizeMapBounds({
      west: Math.min(Number(first[0]), Number(second[0])),
      east: Math.max(Number(first[0]), Number(second[0])),
      south: Math.min(Number(first[1]), Number(second[1])),
      north: Math.max(Number(first[1]), Number(second[1])),
    });
  } catch {
    return null;
  }
}

function mapCoordinateFinder(
  chart: echarts.ECharts,
): { geoIndex: number } | { seriesIndex: number } | null {
  const current = chart.getOption() as { geo?: unknown; series?: unknown } | null;
  if (!current) return null;
  const hasGeo = Array.isArray(current.geo) ? current.geo.length > 0 : !!current.geo;
  if (hasGeo) return { geoIndex: 0 };
  const series = Array.isArray(current.series) ? current.series : current.series ? [current.series] : [];
  const mapSeriesIndex = series.findIndex((item) =>
    !!item && typeof item === 'object' && (item as { type?: unknown }).type === 'map');
  return mapSeriesIndex >= 0 ? { seriesIndex: mapSeriesIndex } : null;
}

function visibleMapBounds(chart: echarts.ECharts): MapBounds | null {
  const finder = mapCoordinateFinder(chart);
  if (!finder) return null;
  try {
    const leftTop = chart.convertFromPixel(finder, [0, 0]);
    const rightBottom = chart.convertFromPixel(finder, [chart.getWidth(), chart.getHeight()]);
    if (!Array.isArray(leftTop) || !Array.isArray(rightBottom)) return null;
    return normalizeMapBounds({
      west: Math.min(Number(leftTop[0]), Number(rightBottom[0])),
      east: Math.max(Number(leftTop[0]), Number(rightBottom[0])),
      south: Math.min(Number(leftTop[1]), Number(rightBottom[1])),
      north: Math.max(Number(leftTop[1]), Number(rightBottom[1])),
    });
  } catch {
    return null;
  }
}
