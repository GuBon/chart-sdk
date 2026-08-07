/**
 * ColorBrewer palette behavior shared by Admin defaults and the server boundary.
 * Palette specifications live in colorBrewerSchemes.ts with no external color runtime.
 */
import {
  COLORBREWER_SCHEMES,
  colorBrewerScheme,
  isColorBrewerPreset,
  type ColorBrewerFamily,
  type ColorBrewerPreset,
  type ColorBrewerPresetForFamily,
} from '@chartsdk/chart-options/colorBrewerSchemes';

export type PaletteChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'boxplot' | 'heatmap' | 'map' | 'geoscatter';
export type PaletteFamily = ColorBrewerFamily;
export type QualitativePalettePreset = ColorBrewerPresetForFamily<'qualitative'>;
export type SequentialPalettePreset = ColorBrewerPresetForFamily<'sequential'>;
export type DivergingPalettePreset = ColorBrewerPresetForFamily<'diverging'>;
export type { ColorBrewerPreset } from '@chartsdk/chart-options/colorBrewerSchemes';

export interface ColorBrewerPaletteChoice {
  value: ColorBrewerPreset;
  label: string;
  family: PaletteFamily;
  maxClasses: number;
}

function choicesForFamily(family: PaletteFamily): ColorBrewerPaletteChoice[] {
  return Object.entries(COLORBREWER_SCHEMES)
    .filter(([, scheme]) => scheme.family === family)
    .map(([value, scheme]) => ({
      value: value as ColorBrewerPreset,
      label: scheme.label,
      family: scheme.family,
      maxClasses: scheme.maxClasses,
    }));
}

export const COLORBREWER_QUALITATIVE_CHOICES = choicesForFamily('qualitative');
export const COLORBREWER_SEQUENTIAL_CHOICES = choicesForFamily('sequential');
export const COLORBREWER_DIVERGING_CHOICES = choicesForFamily('diverging');
export const COLORBREWER_CHOICES: ColorBrewerPaletteChoice[] = [
  ...COLORBREWER_QUALITATIVE_CHOICES,
  ...COLORBREWER_SEQUENTIAL_CHOICES,
  ...COLORBREWER_DIVERGING_CHOICES,
];

export const DEFAULT_QUALITATIVE_PRESET: QualitativePalettePreset = 'dark2';
export const DEFAULT_SEQUENTIAL_PRESET: SequentialPalettePreset = 'blues';
export const DEFAULT_DIVERGING_PRESET: DivergingPalettePreset = 'rdbu';
export const DEFAULT_PALETTE_PRESET = DEFAULT_QUALITATIVE_PRESET;
export const DEFAULT_PALETTE = colorBrewerPalette(DEFAULT_PALETTE_PRESET);

const FAMILY_CHOICES: Record<PaletteFamily, ColorBrewerPaletteChoice[]> = {
  qualitative: COLORBREWER_QUALITATIVE_CHOICES,
  sequential: COLORBREWER_SEQUENTIAL_CHOICES,
  diverging: COLORBREWER_DIVERGING_CHOICES,
};

export interface ColorThemeState {
  version: 4;
  qualitativePreset: QualitativePalettePreset;
  sequentialPreset: SequentialPalettePreset;
  divergingPreset: DivergingPalettePreset;
  valueFamily: 'sequential' | 'diverging';
  valueReversed: boolean;
}

export const DEFAULT_COLOR_THEME: ColorThemeState = {
  version: 4,
  qualitativePreset: DEFAULT_QUALITATIVE_PRESET,
  sequentialPreset: DEFAULT_SEQUENTIAL_PRESET,
  divergingPreset: DEFAULT_DIVERGING_PRESET,
  valueFamily: 'sequential',
  valueReversed: false,
};

/** Current chart's primary ColorBrewer data nature. */
export function paletteFamilyForChartType(chartType: unknown): 'qualitative' | 'sequential' {
  return isValueColorChart(chartType) ? 'sequential' : 'qualitative';
}

export function paletteFamilyOrderForChartType(chartType: unknown): PaletteFamily[] {
  return isValueColorChart(chartType)
    ? ['sequential', 'diverging']
    : ['qualitative'];
}

export function paletteChoicesForChartType(chartType: unknown): ColorBrewerPaletteChoice[] {
  return paletteFamilyOrderForChartType(chartType).flatMap((family) => FAMILY_CHOICES[family]);
}

export function paletteFamilyOfPreset(preset: unknown): PaletteFamily | null {
  return colorBrewerScheme(preset)?.family ?? null;
}

export function isPalettePresetForFamily<Family extends PaletteFamily>(
  preset: unknown,
  family: Family,
): preset is ColorBrewerPresetForFamily<Family> {
  return paletteFamilyOfPreset(preset) === family;
}

export { isColorBrewerPreset };

export function isContinuousPalettePreset(preset: unknown): boolean {
  const family = paletteFamilyOfPreset(preset);
  return family === 'sequential' || family === 'diverging';
}

export function defaultPalettePresetForChartType(chartType: unknown): ColorBrewerPreset {
  return isValueColorChart(chartType)
    ? DEFAULT_SEQUENTIAL_PRESET
    : DEFAULT_QUALITATIVE_PRESET;
}

export function colorBrewerColorAt(preset: unknown, position: number): string {
  const colors = colorBrewerPalette(preset);
  const normalizedPosition = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));
  if (!isContinuousPalettePreset(preset)) {
    const index = Math.min(colors.length - 1, Math.floor(normalizedPosition * colors.length));
    return colors[Math.max(0, index)] ?? DEFAULT_PALETTE[0];
  }
  const scaled = normalizedPosition * (colors.length - 1);
  const leftIndex = Math.floor(scaled);
  const rightIndex = Math.min(colors.length - 1, leftIndex + 1);
  return interpolateHex(colors[leftIndex], colors[rightIndex], scaled - leftIndex);
}

/** Returns the largest official ColorBrewer class set for the selected palette. */
export function colorBrewerPalette(preset: unknown): string[] {
  const scheme = colorBrewerScheme(preset) ?? COLORBREWER_SCHEMES[DEFAULT_PALETTE_PRESET];
  return [...scheme.colors];
}

export function colorBrewerPaletteForChartType(chartType: unknown, preset: unknown): string[] {
  const selected = isPaletteAllowedForChartType(chartType, preset)
    ? preset
    : defaultPalettePresetForChartType(chartType);
  return colorBrewerPalette(selected);
}

export function normalizeColorTheme(value: unknown, activePreset?: unknown, activeChartType?: unknown): ColorThemeState {
  const source = value != null && typeof value === 'object'
    ? value as Partial<ColorThemeState>
    : {};
  const current = source.version === 4 ? source : {};
  const theme: ColorThemeState = {
    version: 4,
    qualitativePreset: isPalettePresetForFamily(current.qualitativePreset, 'qualitative')
      ? current.qualitativePreset
      : DEFAULT_QUALITATIVE_PRESET,
    sequentialPreset: isPalettePresetForFamily(current.sequentialPreset, 'sequential')
      ? current.sequentialPreset
      : DEFAULT_SEQUENTIAL_PRESET,
    divergingPreset: isPalettePresetForFamily(current.divergingPreset, 'diverging')
      ? current.divergingPreset
      : DEFAULT_DIVERGING_PRESET,
    valueFamily: current.valueFamily === 'diverging' ? 'diverging' : 'sequential',
    valueReversed: current.valueReversed === true,
  };
  if (isPaletteAllowedForChartType(activeChartType, activePreset)) {
    rememberPreset(theme, activePreset);
  }
  return theme;
}

/** A palette change resets generated colors while preserving later explicit user overrides. */
export function applyPalettePreset(
  options: Record<string, any>,
  chartType: PaletteChartType,
  preset: unknown,
): Record<string, any> {
  const next = structuredClone(options);
  const selected = isPaletteAllowedForChartType(chartType, preset)
    ? preset
    : defaultPalettePresetForChartType(chartType);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, chartType);
  rememberPreset(theme, selected);
  next.colorTheme = theme;
  next.palettePreset = selected;
  next.palette = colorBrewerPalette(selected);
  next.paletteActiveIndex = 0;
  next.paletteReversed = isContinuousPalettePreset(selected) && theme.valueReversed;
  next.autoColorMap = {};
  return next;
}

export function applyPaletteDirection(
  options: Record<string, any>,
  chartType: PaletteChartType,
  reversed: boolean,
): Record<string, any> {
  const next = structuredClone(options);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, chartType);
  if (isValueColorChart(chartType) && isContinuousPalettePreset(next.palettePreset)) {
    theme.valueReversed = reversed;
    next.paletteReversed = reversed;
  } else {
    next.paletteReversed = false;
  }
  next.colorTheme = theme;
  return next;
}

/** Remembers independent qualitative, sequential, and diverging choices across chart-type changes. */
export function switchPaletteForChartType(
  options: Record<string, any>,
  from: PaletteChartType,
  to: PaletteChartType,
): Record<string, any> {
  const next = structuredClone(options);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, from);
  if (isPaletteAllowedForChartType(from, next.palettePreset)) {
    rememberPreset(theme, next.palettePreset);
  }
  if (isValueColorChart(from) && isContinuousPalettePreset(next.palettePreset)) {
    theme.valueReversed = next.paletteReversed === true;
  }

  const changesColorRole = isValueColorChart(from) !== isValueColorChart(to);
  if (changesColorRole || !isPaletteAllowedForChartType(to, next.palettePreset)) {
    const targetPreset = isValueColorChart(to)
      ? valuePreset(theme)
      : theme.qualitativePreset;
    next.palettePreset = targetPreset;
    next.palette = colorBrewerPalette(targetPreset);
    next.paletteActiveIndex = 0;
    next.paletteReversed = isValueColorChart(to) && theme.valueReversed;
    next.autoColorMap = {};
  }
  next.colorTheme = theme;
  return next;
}

export function resolveSeriesColorMap(
  names: string[],
  palette: readonly string[] = DEFAULT_PALETTE,
  existing: Record<string, string> = {},
  spreadAcrossGradient = false,
): Record<string, string> {
  const usable = palette.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  const base = usable.length > 0 ? usable.map((color) => color.toUpperCase()) : DEFAULT_PALETTE;
  const resolved: Record<string, string> = { ...existing };

  if (spreadAcrossGradient) {
    const gradient = sampleGradient(base, names.length);
    names.forEach((name, index) => {
      resolved[name] = gradient[index];
    });
    return resolved;
  }

  names.forEach((name, index) => {
    if (resolved[name]) return;
    resolved[name] = base[index % base.length];
  });
  return resolved;
}

function isValueColorChart(chartType: unknown): boolean {
  return chartType === 'heatmap' || chartType === 'map';
}

function isPaletteAllowedForChartType(chartType: unknown, preset: unknown): preset is ColorBrewerPreset {
  const family = paletteFamilyOfPreset(preset);
  return isValueColorChart(chartType)
    ? family === 'sequential' || family === 'diverging'
    : family === 'qualitative';
}

function rememberPreset(theme: ColorThemeState, preset: ColorBrewerPreset): void {
  const family = paletteFamilyOfPreset(preset);
  if (family === 'qualitative') theme.qualitativePreset = preset as QualitativePalettePreset;
  if (family === 'sequential') {
    theme.sequentialPreset = preset as SequentialPalettePreset;
    theme.valueFamily = 'sequential';
  }
  if (family === 'diverging') {
    theme.divergingPreset = preset as DivergingPalettePreset;
    theme.valueFamily = 'diverging';
  }
}

function valuePreset(theme: ColorThemeState): SequentialPalettePreset | DivergingPalettePreset {
  return theme.valueFamily === 'diverging'
    ? theme.divergingPreset
    : theme.sequentialPreset;
}

function sampleGradient(stops: readonly string[], count: number): string[] {
  if (count <= 0) return [];
  if (stops.length === 1) return Array.from({ length: count }, () => stops[0]);
  return Array.from({ length: count }, (_unused, index) => {
    const position = count === 1 ? 0.5 : index / (count - 1);
    const scaled = position * (stops.length - 1);
    const leftIndex = Math.floor(scaled);
    const rightIndex = Math.min(stops.length - 1, leftIndex + 1);
    return interpolateHex(stops[leftIndex], stops[rightIndex], scaled - leftIndex);
  });
}

function interpolateHex(left: string, right: string, ratio: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const start = Number.parseInt(left.slice(offset, offset + 2), 16);
    const end = Number.parseInt(right.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * ratio).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`.toUpperCase();
}
