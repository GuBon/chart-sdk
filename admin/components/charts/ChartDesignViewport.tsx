'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MajorType } from '@chartsdk/chart-options';
import type { ColorSelection } from '@chartsdk/chart-options/colorOverrides';
import type { ChartDesignSize, PreviewFitMode } from '@chartsdk/chart-options/display';
import type { MapBounds, MapViewport } from '@chartsdk/chart-options/geo';
import { ChartPreview, type MapBoundsChangeSource } from './ChartPreview';
import { cn } from '@/lib/cn';

interface Props {
  option: Record<string, unknown>;
  chartType: MajorType;
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

const VIEWPORT_PADDING = 24;

/**
 * ECharts는 논리 설계 크기로 렌더하고, 바깥 래퍼만 CSS scale한다.
 * 따라서 FHD를 화면 맞춤으로 축소해도 글꼴·여백·말줄임 계산은 1920×1080 기준으로 검수할 수 있다.
 */
export function ChartDesignViewport({
  option,
  chartType,
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
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (fitMode === 'actual') return Math.min(2, Math.max(0.1, zoom / 100));
    const availableWidth = Math.max(1, viewport.width - VIEWPORT_PADDING * 2);
    const availableHeight = Math.max(1, viewport.height - VIEWPORT_PADDING * 2);
    const widthScale = availableWidth / designSize.width;
    if (fitMode === 'width') return Math.min(1, widthScale);
    return Math.min(1, widthScale, availableHeight / designSize.height);
  }, [designSize.height, designSize.width, fitMode, viewport.height, viewport.width, zoom]);

  const scaledWidth = Math.max(1, Math.round(designSize.width * scale));
  const scaledHeight = Math.max(1, Math.round(designSize.height * scale));
  const stageWidth = Math.max(viewport.width, scaledWidth + VIEWPORT_PADDING * 2);
  const stageHeight = Math.max(viewport.height, scaledHeight + VIEWPORT_PADDING * 2);
  const left = Math.max(VIEWPORT_PADDING, Math.round((stageWidth - scaledWidth) / 2));
  const top = Math.max(VIEWPORT_PADDING, Math.round((stageHeight - scaledHeight) / 2));

  return (
    <div
      ref={viewportRef}
      data-testid={testId}
      data-fit-mode={fitMode}
      data-scale={scale.toFixed(4)}
      className={cn('relative h-full w-full overflow-auto bg-muted/40', className)}
    >
      <div className="relative" style={{ width: stageWidth, height: stageHeight }}>
        <div
          data-testid="chart-design-canvas"
          data-design-width={designSize.width}
          data-design-height={designSize.height}
          className="absolute origin-top-left overflow-hidden border border-border bg-white shadow-sm"
          style={{
            left,
            top,
            width: designSize.width,
            height: designSize.height,
            transform: `scale(${scale})`,
          }}
        >
          <ChartPreview
            option={option}
            chartType={chartType}
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
      </div>
    </div>
  );
}
