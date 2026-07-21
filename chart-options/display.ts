export type ChartSizePreset = 'small' | 'standard' | 'large' | 'hd' | 'fhd' | 'custom';
export type PreviewFitMode = 'contain' | 'width' | 'actual';

export interface ChartDesignSize {
  preset: ChartSizePreset;
  width: number;
  height: number;
  label: string;
}

export interface ChartTypography {
  mode: 'auto' | 'custom';
  scale: number;
  title: number;
  legend: number;
  axis: number;
  dataLabel: number;
  tooltip: number;
}

export interface ChartLayoutMetrics {
  titleHeight: number;
  legendHeight: number;
  visualMapHeight: number;
}

export const CHART_SIZE_PRESETS: readonly ChartDesignSize[] = [
  { preset: 'small', width: 360, height: 240, label: '작은 카드 · 360×240' },
  { preset: 'standard', width: 640, height: 360, label: '표준 · 640×360' },
  { preset: 'large', width: 960, height: 540, label: '대형 · 960×540' },
  { preset: 'hd', width: 1280, height: 720, label: 'HD · 1280×720' },
  { preset: 'fhd', width: 1920, height: 1080, label: 'FHD · 1920×1080' },
] as const;

export const DEFAULT_CHART_DESIGN_SIZE = CHART_SIZE_PRESETS[1];
export const MIN_CHART_WIDTH = 240;
export const MAX_CHART_WIDTH = 3840;
export const MIN_CHART_HEIGHT = 180;
export const MAX_CHART_HEIGHT = 2160;

const TYPOGRAPHY_BY_PRESET: Record<Exclude<ChartSizePreset, 'custom'>, Omit<ChartTypography, 'mode' | 'scale'>> = {
  small: { title: 14, legend: 10, axis: 10, dataLabel: 10, tooltip: 10 },
  standard: { title: 18, legend: 12, axis: 12, dataLabel: 12, tooltip: 12 },
  large: { title: 22, legend: 14, axis: 14, dataLabel: 14, tooltip: 14 },
  hd: { title: 24, legend: 15, axis: 15, dataLabel: 15, tooltip: 15 },
  fhd: { title: 26, legend: 16, axis: 16, dataLabel: 16, tooltip: 16 },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePreset(value: unknown): ChartSizePreset {
  return value === 'small' || value === 'large' || value === 'hd' || value === 'fhd' || value === 'custom'
    ? value
    : 'standard';
}

/** 저장된 options에서 차트가 설계된 논리 크기를 복원한다. 실제 임베드 DOM 크기는 이 값으로 강제하지 않는다. */
export function resolveChartDesignSize(options: Record<string, unknown>): ChartDesignSize {
  const display = record(options.display);
  const preset = normalizePreset(display.preset);
  if (preset !== 'custom') return CHART_SIZE_PRESETS.find((item) => item.preset === preset) ?? DEFAULT_CHART_DESIGN_SIZE;

  const width = Math.round(clamp(finiteNumber(display.width, DEFAULT_CHART_DESIGN_SIZE.width), MIN_CHART_WIDTH, MAX_CHART_WIDTH));
  const height = Math.round(clamp(finiteNumber(display.height, DEFAULT_CHART_DESIGN_SIZE.height), MIN_CHART_HEIGHT, MAX_CHART_HEIGHT));
  return { preset, width, height, label: `사용자 지정 · ${width}×${height}` };
}

function autoTypographyFor(size: ChartDesignSize): Omit<ChartTypography, 'mode' | 'scale'> {
  if (size.preset !== 'custom') return TYPOGRAPHY_BY_PRESET[size.preset];
  const ratio = clamp(Math.sqrt(size.width / DEFAULT_CHART_DESIGN_SIZE.width), 0.78, 1.5);
  return {
    title: Math.round(18 * ratio),
    legend: Math.round(12 * ratio),
    axis: Math.round(12 * ratio),
    dataLabel: Math.round(12 * ratio),
    tooltip: Math.round(12 * ratio),
  };
}

/** 논리 차트 크기와 사용자 글꼴 설정을 최종 ECharts px 값으로 변환한다. */
export function resolveChartTypography(options: Record<string, unknown>): ChartTypography {
  const typography = record(options.typography);
  const mode = typography.mode === 'custom' ? 'custom' : 'auto';
  const scale = Math.round(clamp(finiteNumber(typography.scale, 100), 80, 150));
  const base = autoTypographyFor(resolveChartDesignSize(options));
  if (mode === 'custom') {
    return {
      mode,
      scale,
      title: Math.round(clamp(finiteNumber(typography.titleFontSize, 18), 10, 48)),
      legend: Math.round(clamp(finiteNumber(typography.legendFontSize, 12), 8, 32)),
      axis: Math.round(clamp(finiteNumber(typography.axisFontSize, 12), 8, 32)),
      dataLabel: Math.round(clamp(finiteNumber(typography.dataLabelFontSize, 12), 8, 32)),
      tooltip: Math.round(clamp(finiteNumber(typography.tooltipFontSize, 12), 8, 32)),
    };
  }

  const scaled = (value: number, min: number, max: number) => Math.round(clamp(value * scale / 100, min, max));
  return {
    mode,
    scale,
    title: scaled(base.title, 10, 48),
    legend: scaled(base.legend, 8, 32),
    axis: scaled(base.axis, 8, 32),
    dataLabel: scaled(base.dataLabel, 8, 32),
    tooltip: scaled(base.tooltip, 8, 32),
  };
}

/** 단일행 제목·범례와 visualMap이 차지하는 세로 블록. 기본 640×360에서는 기존 26/24/36px와 동일하다. */
export function resolveChartLayoutMetrics(options: Record<string, unknown>): ChartLayoutMetrics {
  const typography = resolveChartTypography(options);
  const titleHeight = Math.ceil(typography.title * 1.2) + 4;
  const legendHeight = Math.ceil(typography.legend * 1.25) + 9;
  return {
    titleHeight,
    legendHeight,
    visualMapHeight: legendHeight + 12,
  };
}
