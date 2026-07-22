'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import krSido from '@chartsdk/chart-options/maps/kr-sido.json';
import krSigungu from '@chartsdk/chart-options/maps/kr-sigungu.json';
import { applyMapViewport, normalizeMapBounds, takeEmbeddedMaps, type MapBounds } from '@chartsdk/chart-options/geo';
import { hasChartTitle, responsiveTitlePatch, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';

// 지도(map·geoscatter) 차트용 GeoJSON 등록 — 모듈 로드 시 1회. registerMap 은 DOM 불요라 SSR 안전.
// 미리보기(에디터)와 S1 썸네일(MiniChart)이 이 컴포넌트를 공유하므로 여기서 등록하면 양쪽 모두 커버.
echarts.registerMap('kr-sido', krSido as never);
echarts.registerMap('kr-sigungu', krSigungu as never);

// S2 우측 상단 차트 미리보기. 서버(목 변환기)가 조립한 ECharts option 을 setOption 만 한다.
// (방식 A — 클라이언트는 모양을 결정하지 않는다. SDK 와 동일 규약.)
export function ChartPreview({
  option,
  mapViewportEditing = false,
  onMapBoundsChange,
}: {
  option: Record<string, unknown> | null;
  mapViewportEditing?: boolean;
  onMapBoundsChange?: (bounds: MapBounds | null) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const hasTitleRef = useRef(false);
  const onMapBoundsChangeRef = useRef(onMapBoundsChange);

  useEffect(() => {
    onMapBoundsChangeRef.current = onMapBoundsChange;
  }, [onMapBoundsChange]);

  useEffect(() => {
    if (!elRef.current) return;
    const el = elRef.current;
    const chart = echarts.init(el);
    chartRef.current = chart;
    const reportMapBounds = () => {
      const bounds = visibleMapBounds(chart);
      onMapBoundsChangeRef.current?.(bounds);
    };
    chart.on('georoam', reportMapBounds);
    const ro = new ResizeObserver(() => {
      chart.resize();
      if (hasTitleRef.current) chart.setOption(responsiveTitlePatch(el.clientWidth));
      reportMapBounds();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.off('georoam', reportMapBounds);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!chart || !el) return;
    if (option) {
      const renderOption = structuredClone(option);
      for (const embedded of takeEmbeddedMaps(renderOption)) {
        if (!echarts.getMap(embedded.name)) echarts.registerMap(embedded.name, embedded.geoJSON as never);
      }
      applyMapViewport(renderOption, (name) => echarts.getMap(name));
      // Admin 미리보기는 저장 옵션의 roam 여부와 무관하게 탐색 가능해야 한다.
      // 임베드/최종 차트의 인터랙션 여부는 기존 map.roam 옵션을 계속 따른다.
      enableMapRoam(renderOption);
      hasTitleRef.current = hasChartTitle(renderOption);
      chart.setOption(withResponsiveTitle(renderOption, el.clientWidth), true);
      requestAnimationFrame(() => onMapBoundsChangeRef.current?.(visibleMapBounds(chart)));
    } else {
      hasTitleRef.current = false;
      chart.clear();
      onMapBoundsChangeRef.current?.(null);
    }
  }, [option]);

  useEffect(() => {
    if (!mapViewportEditing) return;
    const chart = chartRef.current;
    if (!chart) return;
    // 저장 모드 진입 시 setOption으로 사용자가 이미 맞춘 위치를 초기화하지 않고,
    // 현재 화면만 다시 보고해 곧바로 [현재 지도 영역 적용]할 수 있게 한다.
    const frame = requestAnimationFrame(() => onMapBoundsChangeRef.current?.(visibleMapBounds(chart)));
    return () => cancelAnimationFrame(frame);
  }, [mapViewportEditing]);

  return <div ref={elRef} data-testid="chart-preview" className="h-full w-full" />;
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

function visibleMapBounds(chart: echarts.ECharts): MapBounds | null {
  const current = chart.getOption() as { geo?: unknown; series?: unknown };
  const hasGeo = Array.isArray(current.geo) ? current.geo.length > 0 : !!current.geo;
  const series = Array.isArray(current.series) ? current.series : current.series ? [current.series] : [];
  const mapSeriesIndex = series.findIndex((item) => !!item && typeof item === 'object' && (item as { type?: unknown }).type === 'map');
  if (!hasGeo && mapSeriesIndex < 0) return null;

  const finder = hasGeo ? { geoIndex: 0 } : { seriesIndex: mapSeriesIndex };
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
