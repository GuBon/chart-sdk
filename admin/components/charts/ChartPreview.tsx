'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { MajorType } from '@chartsdk/chart-options';
import type { ColorSelection } from '@chartsdk/chart-options/colorOverrides';
import { hydrateValueFormat } from '@chartsdk/chart-options/valueFormat';
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
import { responsiveTitlePatch, usesResponsiveTitle, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';
import { ensureChartWebFonts } from '@chartsdk/chart-options/webFonts';
import {
  colorSelectionFromChartClick,
  locateColorSelection,
  type ChartColorClick,
  type LocatedColorItem,
} from '@/lib/chartColorSelection';
import { cn } from '@/lib/cn';

export type MapBoundsChangeSource = 'sync' | 'roam' | 'box';

const PREVIEW_DATA_ZOOM_CHART_TYPES = new Set<MajorType>(['bar', 'line', 'scatter', 'boxplot', 'heatmap']);

export function supportsPreviewDataZoom(chartType: MajorType): boolean {
  return PREVIEW_DATA_ZOOM_CHART_TYPES.has(chartType);
}

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
  colorPicking = false,
  colorSelection = null,
  onColorSelection,
  onColorPickingChange,
  transientDataZoom = false,
}: {
  option: Record<string, unknown> | null;
  chartType?: MajorType;
  mapViewportEditing?: boolean;
  mapViewport?: MapViewport;
  mapViewportRevision?: number;
  mapBoxZoomEnabled?: boolean;
  onMapBoundsChange?: (bounds: MapBounds | null, source: MapBoundsChangeSource) => void;
  colorPicking?: boolean;
  colorSelection?: ColorSelection | null;
  onColorSelection?: (selection: Extract<ColorSelection, { scope: 'item' }>) => void;
  onColorPickingChange?: (picking: boolean) => void;
  /** 편집 미리보기에서만 쓰는 임시 휠 줌. 저장 옵션과 임베드 결과에는 반영하지 않는다. */
  transientDataZoom?: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const hasTitleRef = useRef(false);
  const hasRenderedRef = useRef(false);
  const renderedMapViewportRevisionRef = useRef<number | null>(null);
  const onMapBoundsChangeRef = useRef(onMapBoundsChange);
  const mapViewportRef = useRef(mapViewport);
  const chartTypeRef = useRef(chartType);
  const colorPickingRef = useRef(colorPicking);
  const onColorSelectionRef = useRef(onColorSelection);
  const selectedLocationRef = useRef<LocatedColorItem | null>(null);
  const roamFrameRef = useRef<number | null>(null);
  const shiftPressedRef = useRef(false);
  const boxDragRef = useRef<BoxDrag | null>(null);
  const transientDataZoomRef = useRef(transientDataZoom);
  const [boxZoomArmed, setBoxZoomArmed] = useState(false);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);
  const [previewZoomed, setPreviewZoomed] = useState(false);

  useEffect(() => {
    onMapBoundsChangeRef.current = onMapBoundsChange;
  }, [onMapBoundsChange]);

  useEffect(() => {
    mapViewportRef.current = mapViewport;
  }, [mapViewport]);

  useEffect(() => {
    chartTypeRef.current = chartType;
    colorPickingRef.current = colorPicking;
    onColorSelectionRef.current = onColorSelection;
    transientDataZoomRef.current = transientDataZoom;
  }, [chartType, colorPicking, onColorSelection, transientDataZoom]);

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
    const selectChartItem = (params: ChartColorClick) => {
      if (!colorPickingRef.current) return;
      const selection = colorSelectionFromChartClick(
        chartTypeRef.current,
        params,
        chart.getOption() as Record<string, unknown>,
      );
      if (selection) onColorSelectionRef.current?.(selection);
    };
    const reportDataZoom = () => {
      setPreviewZoomed(transientDataZoomRef.current && hasActiveDataZoom(chart));
    };
    chart.on('georoam', reportRoamedMapBounds);
    chart.on('click', selectChartItem);
    chart.on('datazoom', reportDataZoom);
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
      chart.off('click', selectChartItem);
      chart.off('datazoom', reportDataZoom);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!chart || !el) return;
    let cancelled = false;
    if (option) {
      const isMapChart = chartType === 'map' || chartType === 'geoscatter';
      const preserveCurrentCamera = isMapChart
        && hasRenderedRef.current
        && renderedMapViewportRevisionRef.current === mapViewportRevision;
      const mapCamera = preserveCurrentCamera ? currentMapCamera(chart) : null;
      const renderOption = structuredClone(option);
      delete renderOption.__chartsdkAutoColorMap;
      delete renderOption.__chartsdkShowComputedAt;
      hydrateValueFormat(renderOption);
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
      if (transientDataZoom && supportsPreviewDataZoom(chartType)) {
        enablePreviewDataZoom(renderOption, chartType);
      }
      if (mapCamera) applyMapCamera(renderOption, mapCamera);
      applyColorEditorState(renderOption, colorPickingRef.current);
      hasTitleRef.current = usesResponsiveTitle(renderOption);
      void (async () => {
        await ensureChartWebFonts(renderOption, `${window.location.origin}/`);
        if (cancelled || chart.isDisposed()) return;
        chart.setOption(withResponsiveTitle(renderOption, el.clientWidth), true);
        setPreviewZoomed(false);
        hasRenderedRef.current = true;
        renderedMapViewportRevisionRef.current = mapViewportRevision;
        requestAnimationFrame(() => onMapBoundsChangeRef.current?.(visibleMapBounds(chart), 'sync'));
      })();
    } else {
      hasTitleRef.current = false;
      hasRenderedRef.current = false;
      renderedMapViewportRevisionRef.current = null;
      chart.clear();
      setPreviewZoomed(false);
      onMapBoundsChangeRef.current?.(null, 'sync');
    }
    return () => {
      cancelled = true;
    };
  }, [chartType, mapViewportRevision, option, transientDataZoom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !option || !hasRenderedRef.current) return;
    const patches = colorPickingPatches(option, colorPicking);
    if (patches) chart.setOption({ series: patches });
  }, [colorPicking, option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const previous = selectedLocationRef.current;
    if (previous) chart.dispatchAction({ type: 'unselect', ...previous });
    if (!colorPicking) {
      selectedLocationRef.current = null;
      return;
    }
    const located = locateColorSelection(
      chart.getOption() as Record<string, unknown>,
      chartType,
      colorSelection,
    );
    selectedLocationRef.current = located;
    if (located) chart.dispatchAction({ type: 'select', ...located });
  }, [chartType, colorPicking, colorSelection, option]);

  useEffect(() => {
    if (!colorPicking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onColorPickingChange?.(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [colorPicking, onColorPickingChange]);

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
        if (colorPickingRef.current) onColorPickingChange?.(false);
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
  }, [chartType, mapBoxZoomEnabled, onColorPickingChange]);

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
  const previewDataZoomEnabled = transientDataZoom && supportsPreviewDataZoom(chartType);

  const resetPreviewDataZoom = () => {
    if (!previewDataZoomEnabled) return;
    const chart = chartRef.current;
    if (!chart) return;
    const dataZoom = asObjects((chart.getOption() as Record<string, unknown>).dataZoom);
    dataZoom.forEach((_item, dataZoomIndex) => {
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex, start: 0, end: 100 });
    });
    setPreviewZoomed(false);
  };

  return (
    <div
      data-testid="chart-preview"
      data-color-picking={colorPicking}
      data-map-viewport-editing={mapViewportEditing}
      data-box-zoom-armed={boxZoomArmed}
      data-preview-data-zoom={previewDataZoomEnabled}
      data-preview-data-zoomed={previewZoomed}
      onDoubleClick={resetPreviewDataZoom}
      className={cn('relative h-full w-full', colorPicking && 'cursor-crosshair')}
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

function applyColorEditorState(option: Record<string, unknown>, colorPicking: boolean): void {
  const series = option.series;
  for (const item of Array.isArray(series) ? series : series ? [series] : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const target = item as Record<string, any>;
    target.selectedMode = colorPicking ? 'single' : false;
    if (target.type === 'pie') target.selectedOffset = 0;
    target.select = {
      ...(target.select ?? {}),
      itemStyle: {
        ...(target.select?.itemStyle ?? {}),
        borderColor: '#111827',
        borderWidth: 2,
      },
    };
    if (colorPicking && target.type === 'line') {
      target.showSymbol = true;
      target.symbolSize = Math.max(8, typeof target.symbolSize === 'number' ? target.symbolSize : 4);
    }
  }
}

function colorPickingPatches(option: Record<string, unknown>, colorPicking: boolean): Record<string, unknown>[] | null {
  const source = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  if (source.length === 0) return null;
  const patches = source.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
    const line = item as Record<string, unknown>;
    if (line.type !== 'line') return { selectedMode: colorPicking ? 'single' : false };
    const symbolSize = typeof line.symbolSize === 'number' ? line.symbolSize : 4;
    return {
      selectedMode: colorPicking ? 'single' : false,
      showSymbol: colorPicking ? true : line.showSymbol,
      symbolSize: colorPicking ? Math.max(8, symbolSize) : symbolSize,
    };
  });
  return patches;
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

/**
 * 편집기에서 값을 자세히 살피기 위한 임시 inside dataZoom.
 * 서버가 만든 option의 복제본에만 추가하므로 저장 options와 임베드 차트는 바뀌지 않는다.
 */
function enablePreviewDataZoom(option: Record<string, unknown>, chartType: MajorType): void {
  if (!supportsPreviewDataZoom(chartType) || asObjects(option.dataZoom).length > 0) return;

  const xAxes = asObjects(option.xAxis);
  const yAxes = asObjects(option.yAxis);
  const xCategoryIndices = xAxes
    .map((axis, index) => axis.type === 'category' ? index : -1)
    .filter((index) => index >= 0);
  const yCategoryIndices = yAxes
    .map((axis, index) => axis.type === 'category' ? index : -1)
    .filter((index) => index >= 0);
  const zoomBothAxes = chartType === 'scatter' || chartType === 'heatmap';
  const zoom: Record<string, unknown> = {
    id: '__chartsdk_preview_data_zoom__',
    type: 'inside',
    filterMode: 'filter',
  };

  if (zoomBothAxes) {
    if (xAxes.length > 0) zoom.xAxisIndex = xAxes.map((_axis, index) => index);
    if (yAxes.length > 0) zoom.yAxisIndex = yAxes.map((_axis, index) => index);
  } else if (yCategoryIndices.length > 0 && xCategoryIndices.length === 0) {
    zoom.yAxisIndex = yCategoryIndices;
  } else {
    zoom.xAxisIndex = xCategoryIndices.length > 0 ? xCategoryIndices : [0];
  }

  option.dataZoom = [zoom];
}

function hasActiveDataZoom(chart: echarts.ECharts): boolean {
  const dataZoom = asObjects((chart.getOption() as Record<string, unknown>).dataZoom);
  return dataZoom.some((item) => {
    const start = typeof item.start === 'number' ? item.start : 0;
    const end = typeof item.end === 'number' ? item.end : 100;
    return start > 0.01 || end < 99.99;
  });
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
