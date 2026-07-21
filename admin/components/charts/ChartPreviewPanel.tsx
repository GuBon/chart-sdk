'use client';

import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { setPath, type Options } from '@chartsdk/chart-options';
import {
  CHART_SIZE_PRESETS,
  resolveChartDesignSize,
  type ChartSizePreset,
  type PreviewFitMode,
} from '@chartsdk/chart-options/display';
import { Select } from '@/components/ui/Select';
import { ChartDesignViewport } from './ChartDesignViewport';
import { ChartFocusDialog } from './ChartFocusDialog';
import { PreviewFitControls } from './PreviewFitControls';

interface Props {
  option: Record<string, unknown> | null;
  options: Options;
  loading: boolean;
  error: string | null;
  wide: boolean;
  onChangeOptions: (next: Options) => void;
}

export function ChartPreviewPanel({ option, options, loading, error, wide, onChangeOptions }: Props) {
  const [fitMode, setFitMode] = useState<PreviewFitMode>('contain');
  const [zoom, setZoom] = useState(100);
  const [focusOpen, setFocusOpen] = useState(false);
  const designSize = resolveChartDesignSize(options);
  const presetOptions = [
    ...CHART_SIZE_PRESETS.map((item) => ({ value: item.preset, label: item.label })),
    { value: 'custom', label: designSize.preset === 'custom' ? designSize.label : '사용자 지정' },
  ];

  const changePreset = (preset: ChartSizePreset) => {
    const next = structuredClone(options);
    setPath(next, 'display.preset', preset);
    onChangeOptions(next);
    setFitMode('contain');
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chart-preview-panel">
      <div className="shrink-0 border-b border-border bg-bg-panel px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-text-primary">차트 미리보기</h2>
            <p className="truncate text-[11px] text-text-tertiary">논리 캔버스 {designSize.width}×{designSize.height}</p>
          </div>
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="w-[190px]">
            <Select
              aria-label="미리보기 설계 크기"
              value={designSize.preset}
              options={presetOptions}
              onChange={(event) => changePreset(event.target.value as ChartSizePreset)}
              disabled={!option}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex-1" />
          <PreviewFitControls compact={!wide} fitMode={fitMode} zoom={zoom} onFitMode={setFitMode} onZoom={setZoom} />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {option ? (
          <ChartDesignViewport option={option} designSize={designSize} fitMode={fitMode} zoom={zoom} />
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/40 px-4 text-center text-xs text-text-tertiary">
            {loading ? '저장된 미리보기를 불러오는 중…' : error ?? '실행하면 미리보기가 표시됩니다.'}
          </div>
        )}
      </div>

      {focusOpen && option && <ChartFocusDialog option={option} designSize={designSize} onClose={() => setFocusOpen(false)} />}
    </div>
  );
}
