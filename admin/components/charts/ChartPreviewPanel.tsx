'use client';

import { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { setPath, type Options } from '@chartsdk/chart-options';
import type { MajorType } from '@chartsdk/chart-options';
import type { ColorSelection } from '@chartsdk/chart-options/colorOverrides';
import type { MapBounds, MapViewport } from '@chartsdk/chart-options/geo';
import {
  CHART_SIZE_PRESETS,
  MAX_CHART_HEIGHT,
  MAX_CHART_WIDTH,
  MIN_CHART_HEIGHT,
  MIN_CHART_WIDTH,
  resolveChartDesignSize,
  type ChartSizePreset,
  type PreviewFitMode,
} from '@chartsdk/chart-options/display';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ChartDesignViewport } from './ChartDesignViewport';
import { ChartFocusDialog } from './ChartFocusDialog';
import type { MapBoundsChangeSource } from './ChartPreview';
import { PreviewFitControls } from './PreviewFitControls';
import { mapViewportStatus } from './MapViewportControl';

interface Props {
  option: Record<string, unknown> | null;
  options: Options;
  chartType: MajorType;
  computedAt: string | null;
  loading: boolean;
  error: string | null;
  mapViewportEditing: boolean;
  mapViewport: MapViewport;
  mapViewportRevision: number;
  colorPicking: boolean;
  colorSelection: ColorSelection | null;
  onMapBoundsChange: (bounds: MapBounds | null, source: MapBoundsChangeSource) => void;
  onColorSelection: (selection: Extract<ColorSelection, { scope: 'item' }>) => void;
  onColorPickingChange: (picking: boolean) => void;
  onChangeOptions: (next: Options) => void;
}

type SizeDimension = 'width' | 'height';

const SIZE_LIMITS: Record<SizeDimension, { min: number; max: number }> = {
  width: { min: MIN_CHART_WIDTH, max: MAX_CHART_WIDTH },
  height: { min: MIN_CHART_HEIGHT, max: MAX_CHART_HEIGHT },
};

function normalizedDimension(value: number, dimension: SizeDimension): number {
  const { min, max } = SIZE_LIMITS[dimension];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function ChartPreviewPanel({
  option,
  options,
  chartType,
  computedAt,
  loading,
  error,
  mapViewportEditing,
  mapViewport,
  mapViewportRevision,
  colorPicking,
  colorSelection,
  onMapBoundsChange,
  onColorSelection,
  onColorPickingChange,
  onChangeOptions,
}: Props) {
  const designSize = resolveChartDesignSize(options);
  const [fitMode, setFitMode] = useState<PreviewFitMode>('contain');
  const [zoom, setZoom] = useState(100);
  const [focusOpen, setFocusOpen] = useState(false);
  const [widthDraft, setWidthDraft] = useState(String(designSize.width));
  const [heightDraft, setHeightDraft] = useState(String(designSize.height));

  useEffect(() => {
    setWidthDraft(String(designSize.width));
    setHeightDraft(String(designSize.height));
  }, [designSize.height, designSize.width]);

  const presetOptions = [
    ...CHART_SIZE_PRESETS.map((item) => ({ value: item.preset, label: item.label })),
    { value: 'custom', label: designSize.preset === 'custom' ? designSize.label : '사용자 지정' },
  ];

  const changePreset = (preset: ChartSizePreset) => {
    const next = structuredClone(options);
    setPath(next, 'display.preset', preset);
    if (preset === 'custom') {
      // 저장된 width/height가 과거 기본값이어도 현재 프리셋 크기에서 자연스럽게 편집을 시작한다.
      setPath(next, 'display.width', designSize.width);
      setPath(next, 'display.height', designSize.height);
    }
    onChangeOptions(next);
    setFitMode('contain');
  };

  const changeCustomSize = (width: number, height: number) => {
    const normalizedWidth = normalizedDimension(width, 'width');
    const normalizedHeight = normalizedDimension(height, 'height');
    const next = structuredClone(options);
    setPath(next, 'display.preset', 'custom');
    setPath(next, 'display.width', normalizedWidth);
    setPath(next, 'display.height', normalizedHeight);
    setWidthDraft(String(normalizedWidth));
    setHeightDraft(String(normalizedHeight));
    onChangeOptions(next);
    setFitMode('contain');
  };

  const changeDimension = (dimension: SizeDimension, raw: string) => {
    if (dimension === 'width') setWidthDraft(raw);
    else setHeightDraft(raw);

    const parsed = Number(raw);
    const { min, max } = SIZE_LIMITS[dimension];
    if (!raw.trim() || !Number.isFinite(parsed) || parsed < min || parsed > max) return;
    changeCustomSize(
      dimension === 'width' ? parsed : designSize.width,
      dimension === 'height' ? parsed : designSize.height,
    );
  };

  const commitDimension = (dimension: SizeDimension, raw: string) => {
    const parsed = Number(raw);
    if (!raw.trim() || !Number.isFinite(parsed)) {
      if (dimension === 'width') setWidthDraft(String(designSize.width));
      else setHeightDraft(String(designSize.height));
      return;
    }
    changeCustomSize(
      dimension === 'width' ? parsed : designSize.width,
      dimension === 'height' ? parsed : designSize.height,
    );
  };

  return (
    <div id="chart-preview-panel" className="chart-preview-panel flex h-full min-h-0 flex-col" data-testid="chart-preview-panel">
      <div className="shrink-0 border-b border-border bg-bg-panel px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-text-primary">차트 미리보기</h2>
            <p className="truncate text-[11px] text-text-tertiary">논리 캔버스 {designSize.width}×{designSize.height}</p>
          </div>
          {(chartType === 'map' || chartType === 'geoscatter') && (
            <span className="max-w-44 truncate rounded bg-muted px-2 py-1 text-[11px] text-text-secondary" title={`표시 영역: ${mapViewportStatus(mapViewport)}`}>
              표시 영역: {mapViewportEditing ? '지도 조정 중' : mapViewportStatus(mapViewport)}
            </span>
          )}
          {colorPicking && (
            <span
              role="status"
              className="max-w-[min(420px,45vw)] truncate rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
              title="색상을 바꿀 막대·점·조각·지역을 선택하세요. Esc로 종료"
            >
              색상을 바꿀 요소를 선택하세요 · Esc 종료
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            disabled={!option}
            onClick={() => setFocusOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-text-secondary hover:bg-muted hover:text-text-primary disabled:opacity-40"
          >
            <Maximize2 className="size-3.5" />
            전체 화면
          </button>
        </div>
        <div className="chart-preview-toolbar mt-2">
          <div className="chart-preview-size-preset w-[180px]">
            <Select
              aria-label="미리보기 설계 크기"
              value={designSize.preset}
              options={presetOptions}
              onChange={(event) => changePreset(event.target.value as ChartSizePreset)}
              disabled={!option}
              className="h-7 text-xs"
            />
          </div>
          <div className="chart-preview-size-inputs flex items-center gap-1.5" data-testid="chart-size-inputs">
            <label className="relative block w-[72px]">
              <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-medium text-text-tertiary">W</span>
              <Input
                aria-label="차트 너비"
                title={`${MIN_CHART_WIDTH}~${MAX_CHART_WIDTH}px`}
                type="number"
                inputMode="numeric"
                min={MIN_CHART_WIDTH}
                max={MAX_CHART_WIDTH}
                step={1}
                value={widthDraft}
                disabled={!option}
                onChange={(event) => changeDimension('width', event.target.value)}
                onBlur={(event) => commitDimension('width', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                size="sm"
                className="h-7 w-[72px] pl-6 pr-1.5 text-xs tabular-nums"
              />
            </label>
            <span aria-hidden="true" className="text-[11px] text-text-tertiary">×</span>
            <label className="relative block w-[72px]">
              <span aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[10px] font-medium text-text-tertiary">H</span>
              <Input
                aria-label="차트 높이"
                title={`${MIN_CHART_HEIGHT}~${MAX_CHART_HEIGHT}px`}
                type="number"
                inputMode="numeric"
                min={MIN_CHART_HEIGHT}
                max={MAX_CHART_HEIGHT}
                step={1}
                value={heightDraft}
                disabled={!option}
                onChange={(event) => changeDimension('height', event.target.value)}
                onBlur={(event) => commitDimension('height', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                size="sm"
                className="h-7 w-[72px] pl-6 pr-1.5 text-xs tabular-nums"
              />
            </label>
            <span className="text-[11px] text-text-tertiary">px</span>
          </div>
          <PreviewFitControls responsive fitMode={fitMode} zoom={zoom} onFitMode={setFitMode} onZoom={setZoom} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {option ? (
          <ChartDesignViewport
            option={option}
            chartType={chartType}
            computedAt={computedAt}
            designSize={designSize}
            fitMode={fitMode}
            zoom={zoom}
            mapViewportEditing={mapViewportEditing}
            mapViewport={mapViewport}
            mapViewportRevision={mapViewportRevision}
            mapBoxZoomEnabled={!focusOpen}
            onMapBoundsChange={onMapBoundsChange}
            colorPicking={colorPicking}
            colorSelection={colorSelection}
            onColorSelection={onColorSelection}
            onColorPickingChange={onColorPickingChange}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 px-4 text-center text-xs text-text-tertiary">
            {loading ? '저장된 미리보기를 불러오는 중…' : error ?? '실행하면 미리보기가 표시됩니다.'}
          </div>
        )}
      </div>

      {focusOpen && option && (
        <ChartFocusDialog
          option={option}
          chartType={chartType}
          computedAt={computedAt}
          designSize={designSize}
          mapViewportEditing={mapViewportEditing}
          mapViewport={mapViewport}
          mapViewportRevision={mapViewportRevision}
          onMapBoundsChange={onMapBoundsChange}
          colorPicking={colorPicking}
          colorSelection={colorSelection}
          onColorSelection={onColorSelection}
          onColorPickingChange={onColorPickingChange}
          onClose={() => setFocusOpen(false)}
        />
      )}
    </div>
  );
}
