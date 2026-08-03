'use client';

import { useMemo } from 'react';
import type { ChartOptions } from '@/lib/api';
import { ChartPreview } from './ChartPreview';

export function MiniChart({ option }: { option?: ChartOptions | null }) {
  const thumbnailOption = useMemo(
    () => option == null ? option : toThumbnailOption(option),
    [option],
  );

  if (thumbnailOption === null) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md bg-bg-panel/60 text-xs text-text-tertiary">
        preview unavailable
      </div>
    );
  }

  if (thumbnailOption === undefined) {
    return <div className="h-full w-full animate-pulse rounded-md bg-bg-panel/70" />;
  }

  return <ChartPreview option={thumbnailOption} />;
}

function toThumbnailOption(option: ChartOptions): ChartOptions {
  const next = structuredClone(option);
  delete next.title;
  delete next.legend;
  delete next.tooltip;
  delete next.toolbox;
  delete next.dataZoom;
  // visualMap 은 삭제하지 않는다 — heatmap·map 의 색 인코딩이 사라진다. 위젯만 숨긴다(show:false).
  setVisualMapHidden(next.visualMap);
  delete next.graphic;
  next.grid = {
    left: 4,
    right: 4,
    top: 4,
    bottom: 4,
    containLabel: false,
  };
  stripAxisName(next.xAxis);
  stripAxisName(next.yAxis);
  hideAxis(next.xAxis);
  hideAxis(next.yAxis);
  stripSeriesDecoration(next.series);
  return next;
}

function setVisualMapHidden(vm: unknown) {
  if (Array.isArray(vm)) {
    vm.forEach(setVisualMapHidden);
    return;
  }
  if (!vm || typeof vm !== 'object') return;
  (vm as Record<string, unknown>).show = false;
}

function stripAxisName(axis: unknown) {
  if (Array.isArray(axis)) {
    axis.forEach(stripAxisName);
    return;
  }
  if (!axis || typeof axis !== 'object') return;
  const axisOption = axis as Record<string, unknown>;
  delete axisOption.name;
  delete axisOption.nameGap;
  delete axisOption.nameLocation;
  delete axisOption.nameTextStyle;
}

function hideAxis(axis: unknown) {
  if (Array.isArray(axis)) {
    axis.forEach(hideAxis);
    return;
  }
  if (!axis || typeof axis !== 'object') return;
  const axisOption = axis as Record<string, unknown>;
  axisOption.show = false;
  axisOption.axisLabel = { show: false };
  axisOption.axisTick = { show: false };
  axisOption.axisLine = { show: false };
  axisOption.splitLine = { show: false };
  axisOption.splitArea = { show: false };
}

function stripSeriesDecoration(series: unknown) {
  if (Array.isArray(series)) {
    series.forEach(stripSeriesDecoration);
    return;
  }
  if (!series || typeof series !== 'object') return;
  const seriesOption = series as Record<string, unknown>;
  seriesOption.label = { show: false };
  seriesOption.labelLine = { show: false };
  delete seriesOption.markLine;
  delete seriesOption.markPoint;
  delete seriesOption.markArea;
}
