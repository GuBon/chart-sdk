'use client';

import { useLayoutEffect, useRef } from 'react';
import type { MajorType } from '@chartsdk/chart-options';
import type { ColorSelection } from '@chartsdk/chart-options/colorOverrides';
import type { ChartDesignSize, PreviewFitMode } from '@chartsdk/chart-options/display';
import type { MapBounds, MapViewport } from '@chartsdk/chart-options/geo';
import { calculateChartPreviewGeometry } from '@/lib/chartPreviewLayout';
import { ChartPreview, type MapBoundsChangeSource } from './ChartPreview';
import { cn } from '@/lib/cn';

interface Props {
  option: Record<string, unknown>;
  chartType: MajorType;
  computedAt?: string | null;
  designSize: ChartDesignSize;
  fitMode: PreviewFitMode;
  zoom: number;
  className?: string;
  testId?: string;
  mapViewportEditing?: boolean;
  mapViewport?: MapViewport;
  mapViewportRevision?: number;
  mapBoxZoomEnabled?: boolean;
  onMapBoundsChange?: (bounds: MapBounds | null, source: MapBoundsChangeSource) => void;
  colorPicking?: boolean;
  colorSelection?: ColorSelection | null;
  onColorSelection?: (selection: Extract<ColorSelection, { scope: 'item' }>) => void;
  onColorPickingChange?: (picking: boolean) => void;
}

/**
 * ECharts는 논리 설계 크기로 렌더하고, 바깥 래퍼만 CSS scale한다.
 * 따라서 FHD를 화면 맞춤으로 축소해도 글꼴·여백·말줄임 계산은 1920×1080 기준으로 검수할 수 있다.
 */
export function ChartDesignViewport({
  option,
  chartType,
  computedAt = null,
  designSize,
  fitMode,
  zoom,
  className,
  testId = 'chart-design-viewport',
  mapViewportEditing = false,
  mapViewport,
  mapViewportRevision = 0,
  mapBoxZoomEnabled = true,
  onMapBoundsChange,
  colorPicking = false,
  colorSelection = null,
  onColorSelection,
  onColorPickingChange,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastGeometryKeyRef = useRef('');
  const applyGeometryRef = useRef<() => void>(() => {});

  applyGeometryRef.current = () => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !stage || !canvas) return;

    const geometry = calculateChartPreviewGeometry({
      viewportWidth: viewport.clientWidth,
      viewportHeight: viewport.clientHeight,
      designWidth: designSize.width,
      designHeight: designSize.height,
      fitMode,
      zoom,
    });
    const geometryKey = [
      viewport.clientWidth,
      viewport.clientHeight,
      designSize.width,
      designSize.height,
      fitMode,
      zoom,
      geometry.scale,
    ].join(':');
    if (geometryKey === lastGeometryKeyRef.current) return;
    lastGeometryKeyRef.current = geometryKey;

    viewport.dataset.scale = geometry.scale.toFixed(4);
    // 맞춤 모드의 축은 CSS 100%로 즉시 따라가게 해 이전 프레임의 stage 크기가
    // 스크롤바를 만들고 clientWidth/clientHeight를 다시 바꾸는 피드백을 차단한다.
    stage.style.width = fitMode === 'actual' ? `${geometry.stageWidth}px` : '100%';
    stage.style.height = fitMode === 'contain' ? '100%' : `${geometry.stageHeight}px`;
    canvas.style.left = `${geometry.left}px`;
    canvas.style.top = `${geometry.top}px`;
    canvas.style.transform = `scale(${geometry.scale})`;
  };

  // 부모 도킹 방향이 바뀐 커밋에서도 새 레이아웃을 페인트하기 전에 실제 영역을 다시 읽는다.
  useLayoutEffect(() => {
    applyGeometryRef.current();
  });

  // 연속 리사이즈 중에는 React 상태/추가 렌더를 거치지 않고 한 번에 모든 기하 값을 적용한다.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => applyGeometryRef.current();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const showComputedAt = option.__chartsdkShowComputedAt !== false && !!computedAt;

  return (
    <div
      ref={viewportRef}
      data-testid={testId}
      data-fit-mode={fitMode}
      data-scale="1.0000"
      className={cn(
        'relative h-full w-full bg-muted/40',
        fitMode === 'contain' && 'overflow-hidden',
        fitMode === 'width' && 'overflow-x-hidden overflow-y-auto',
        fitMode === 'actual' && 'overflow-auto',
        className,
      )}
    >
      <div ref={stageRef} className="relative">
        <div
          ref={canvasRef}
          data-testid="chart-design-canvas"
          data-design-width={designSize.width}
          data-design-height={designSize.height}
          className="absolute flex origin-top-left flex-col overflow-hidden border border-border bg-white shadow-sm"
          style={{
            width: designSize.width,
            height: designSize.height,
          }}
        >
          <div className="min-h-0 flex-1">
            <ChartPreview
              option={option}
              chartType={chartType}
              transientDataZoom
              mapViewportEditing={mapViewportEditing}
              mapViewport={mapViewport}
              mapViewportRevision={mapViewportRevision}
              mapBoxZoomEnabled={mapBoxZoomEnabled}
              onMapBoundsChange={onMapBoundsChange}
              colorPicking={colorPicking}
              colorSelection={colorSelection}
              onColorSelection={onColorSelection}
              onColorPickingChange={onColorPickingChange}
            />
          </div>
          {showComputedAt && (
            <div
              data-chart-caption=""
              className="shrink-0 border-0 bg-transparent pt-1 text-right font-sans text-[11px] font-normal leading-4 tracking-normal text-[#999]"
            >
              데이터 기준 {formatComputedAt(computedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatComputedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
