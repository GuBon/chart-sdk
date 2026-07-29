export type ChartSizePreset =
  | 'small'
  | 'standard'
  | 'large'
  | 'hd'
  | 'fhd'
  | 'smallPortrait'
  | 'standardPortrait'
  | 'largePortrait'
  | 'hdPortrait'
  | 'fhdPortrait'
  | 'custom';
export type PreviewFitMode = 'contain' | 'width' | 'actual';

export interface ChartDesignSize {
  preset: ChartSizePreset;
  width: number;
  height: number;
  label: string;
}

export type ChartFontFamily = 'default' | 'pretendard' | 'notoSansKr';
export type ChartTextElement = 'title' | 'legend' | 'axis' | 'dataLabel' | 'tooltip';

export const PRETENDARD_FONT_FAMILY = 'ChartSDK Pretendard';
export const NOTO_SANS_KR_FONT_FAMILY = 'ChartSDK Noto Sans KR';

export interface ChartTypography {
  scale: number;
  title: number;
  legend: number;
  axis: number;
  dataLabel: number;
  tooltip: number;
}

export type ChartFontFamilies = Record<ChartTextElement, string | null>;

/** 요소별 글자 크기 자동/직접 지정의 기준이 되는 자동 크기 묶음. */
type AutoTypography = Pick<ChartTypography, 'title' | 'legend' | 'axis' | 'dataLabel' | 'tooltip'>;

export interface ChartLayoutMetrics {
  titleHeight: number;
  legendHeight: number;
  visualMapHeight: number;
}

export const CHART_SIZE_PRESETS: readonly ChartDesignSize[] = [
  { preset: 'small', width: 360, height: 240, label: '가로 카드 · 360×240' },
  { preset: 'standard', width: 640, height: 360, label: '가로 표준 · 640×360' },
  { preset: 'large', width: 960, height: 540, label: '가로 대형 · 960×540' },
  { preset: 'hd', width: 1280, height: 720, label: '가로 HD · 1280×720' },
  { preset: 'fhd', width: 1920, height: 1080, label: '가로 FHD · 1920×1080' },
  { preset: 'smallPortrait', width: 240, height: 360, label: '세로 카드 · 240×360' },
  { preset: 'standardPortrait', width: 360, height: 640, label: '세로 표준 · 360×640' },
  { preset: 'largePortrait', width: 540, height: 960, label: '세로 대형 · 540×960' },
  { preset: 'hdPortrait', width: 720, height: 1280, label: '세로 HD · 720×1280' },
  { preset: 'fhdPortrait', width: 1080, height: 1920, label: '세로 FHD · 1080×1920' },
] as const;

export const DEFAULT_CHART_DESIGN_SIZE = CHART_SIZE_PRESETS[1];
export const MIN_CHART_WIDTH = 240;
export const MAX_CHART_WIDTH = 3840;
export const MIN_CHART_HEIGHT = 180;
export const MAX_CHART_HEIGHT = 2160;

/**
 * 글꼴(패밀리) 3종. 값은 저장 계약이고 스택 문자열이 실제 렌더 결과다.
 * 기본은 스택을 내보내지 않아(null) ECharts 기본 sans-serif 렌더를 그대로 유지한다 —
 * 기존 차트의 외형이 이 기능 도입만으로 바뀌지 않게 하기 위한 의도적 선택이다.
 */
export const FONT_FAMILY_CHOICES: readonly { value: ChartFontFamily; label: string }[] = [
  { value: 'default', label: '기본' },
  { value: 'pretendard', label: 'Pretendard' },
  { value: 'notoSansKr', label: 'Noto Sans KR' },
] as const;

export const FONT_FAMILY_STACKS: Record<ChartFontFamily, string | null> = {
  default: null,
  pretendard: `'${PRETENDARD_FONT_FAMILY}',sans-serif`,
  notoSansKr: `'${NOTO_SANS_KR_FONT_FAMILY}',sans-serif`,
};

const TYPOGRAPHY_BY_PRESET: Record<Exclude<ChartSizePreset, 'custom'>, AutoTypography> = {
  small: { title: 14, legend: 10, axis: 10, dataLabel: 10, tooltip: 10 },
  standard: { title: 18, legend: 12, axis: 12, dataLabel: 12, tooltip: 12 },
  large: { title: 22, legend: 14, axis: 14, dataLabel: 14, tooltip: 14 },
  hd: { title: 24, legend: 15, axis: 15, dataLabel: 15, tooltip: 15 },
  fhd: { title: 26, legend: 16, axis: 16, dataLabel: 16, tooltip: 16 },
  smallPortrait: { title: 14, legend: 10, axis: 10, dataLabel: 10, tooltip: 10 },
  standardPortrait: { title: 18, legend: 12, axis: 12, dataLabel: 12, tooltip: 12 },
  largePortrait: { title: 22, legend: 14, axis: 14, dataLabel: 14, tooltip: 14 },
  hdPortrait: { title: 24, legend: 15, axis: 15, dataLabel: 15, tooltip: 15 },
  fhdPortrait: { title: 26, legend: 16, axis: 16, dataLabel: 16, tooltip: 16 },
};

const CHART_SIZE_PRESET_VALUES = new Set(CHART_SIZE_PRESETS.map((item) => item.preset));

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
  if (value === 'custom') return value;
  return typeof value === 'string' && CHART_SIZE_PRESET_VALUES.has(value as ChartSizePreset)
    ? value as ChartSizePreset
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

function normalizeFontFamily(value: unknown): ChartFontFamily {
  return value === 'pretendard' || value === 'notoSansKr' ? value : 'default';
}

const FONT_FAMILY_OPTION_KEYS: Record<ChartTextElement, string> = {
  title: 'titleFontFamily',
  legend: 'legendFontFamily',
  axis: 'axisFontFamily',
  dataLabel: 'dataLabelFontFamily',
  tooltip: 'tooltipFontFamily',
};

/**
 * 요소별 글꼴 선택을 실제 CSS font-family 스택으로 바꾼다.
 * fontFamily 폴백은 요소별 키가 생기기 전 저장본을 읽기 위한 호환 경로다.
 */
export function resolveChartFontFamilies(options: Record<string, unknown>): ChartFontFamilies {
  const typography = record(options.typography);
  const legacy = typography.fontFamily;
  const resolve = (element: ChartTextElement) =>
    FONT_FAMILY_STACKS[normalizeFontFamily(typography[FONT_FAMILY_OPTION_KEYS[element]] ?? legacy)];
  return {
    title: resolve('title'),
    legend: resolve('legend'),
    axis: resolve('axis'),
    dataLabel: resolve('dataLabel'),
    tooltip: resolve('tooltip'),
  };
}

/** 단일 텍스트 요소의 글꼴 스택을 가져오는 편의 함수. */
export function resolveChartFontFamily(
  options: Record<string, unknown>,
  element: ChartTextElement = 'title',
): string | null {
  return resolveChartFontFamilies(options)[element];
}

function autoTypographyFor(size: ChartDesignSize): AutoTypography {
  if (size.preset !== 'custom') return TYPOGRAPHY_BY_PRESET[size.preset];
  // 사용자 지정 캔버스는 가로·세로를 모두 반영한다. 면적비의 4제곱근을 쓰면 같은 종횡비에서
  // 기존 sqrt(width ratio)와 같은 크기감을 유지하면서, 높이만 바뀌는 경우도 자동 글꼴이 반응한다.
  const areaRatio = (size.width * size.height)
    / (DEFAULT_CHART_DESIGN_SIZE.width * DEFAULT_CHART_DESIGN_SIZE.height);
  const ratio = clamp(Math.pow(areaRatio, 0.25), 0.78, 1.5);
  return {
    title: Math.round(18 * ratio),
    legend: Math.round(12 * ratio),
    axis: Math.round(12 * ratio),
    dataLabel: Math.round(12 * ratio),
    tooltip: Math.round(12 * ratio),
  };
}

/**
 * 논리 차트 크기와 사용자 글꼴 설정을 최종 ECharts px 값으로 변환한다.
 * 요소별로 독립 판정한다 — 저장된 px가 유한수면 그 요소만 직접 지정이고,
 * 없으면 논리 크기 기본값 × 전체 배율을 쓴다. (구 typography.mode 일괄 게이트 폐기)
 */
export function resolveChartTypography(options: Record<string, unknown>): ChartTypography {
  const typography = record(options.typography);
  const scale = Math.round(clamp(finiteNumber(typography.scale, 100), 80, 150));
  const base = autoTypographyFor(resolveChartDesignSize(options));
  const element = (stored: unknown, auto: number, min: number, max: number) =>
    typeof stored === 'number' && Number.isFinite(stored)
      ? Math.round(clamp(stored, min, max))
      : Math.round(clamp(auto * scale / 100, min, max));

  return {
    scale,
    title: element(typography.titleFontSize, base.title, 10, 48),
    legend: element(typography.legendFontSize, base.legend, 8, 32),
    axis: element(typography.axisFontSize, base.axis, 8, 32),
    dataLabel: element(typography.dataLabelFontSize, base.dataLabel, 8, 32),
    tooltip: element(typography.tooltipFontSize, base.tooltip, 8, 32),
  };
}

/**
 * 세로쓰기 제목은 글자 하나가 한 줄이 된다. 코드포인트로 세어 서로게이트 쌍(이모지 등)을 한 글자로 취급한다.
 * 서버 변환기와 같은 수식이어야 범례·grid 위치가 어긋나지 않는다.
 */
function titleLineCount(options: Record<string, unknown>): number {
  if (options.titleDirection !== 'vertical') return 1;
  const text = typeof options.title === 'string' ? options.title : '';
  return Math.max(1, Array.from(text).length);
}

/** 제목 텍스트 방향을 ECharts title.text 로 변환한다. 세로는 코드포인트마다 줄바꿈을 넣어 쌓는다. */
export function resolveChartTitleText(options: Record<string, unknown>): string {
  const text = typeof options.title === 'string' ? options.title : '';
  return options.titleDirection === 'vertical' ? Array.from(text).join('\n') : text;
}

/** 제목·범례와 visualMap이 차지하는 세로 블록. 기본 640×360 가로 제목에서는 기존 26/24/36px와 동일하다. */
export function resolveChartLayoutMetrics(options: Record<string, unknown>): ChartLayoutMetrics {
  const typography = resolveChartTypography(options);
  const titleHeight = Math.ceil(typography.title * 1.2) * titleLineCount(options) + 4;
  const legendHeight = Math.ceil(typography.legend * 1.25) + 9;
  return {
    titleHeight,
    legendHeight,
    visualMapHeight: legendHeight + 12,
  };
}
