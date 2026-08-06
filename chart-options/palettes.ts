/**
 * D3 color themes backed by d3-scale-chromatic.
 *
 * 색상값을 ChartSDK에 복사해 두지 않고 D3가 제공하는 범주형 scheme과 연속형
 * interpolator를 직접 사용한다. 모든 차트가 같은 테마를 제공하되, 현재 차트에
 * 적합한 family가 드롭다운 앞에 오도록 순서만 바꾼다.
 */
import { color as parseD3Color } from 'd3-color';
import {
  interpolateBlues,
  interpolateBrBG,
  interpolateCividis,
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePRGn,
  interpolatePuOr,
  interpolatePurples,
  interpolateRainbow,
  interpolateRdBu,
  interpolateRdGy,
  interpolateRdYlBu,
  interpolateRdYlGn,
  interpolateReds,
  interpolateSinebow,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
  schemeAccent,
  schemeCategory10,
  schemeDark2,
  schemeObservable10,
  schemePaired,
  schemePastel1,
  schemeSet2,
  schemeSet3,
  schemeTableau10,
} from 'd3-scale-chromatic';

export type PaletteChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'boxplot' | 'heatmap' | 'map' | 'geoscatter';
export type PaletteFamily = 'categorical' | 'sequential' | 'diverging' | 'cyclical';

export const D3_CATEGORICAL = {
  category10: schemeCategory10,
  accent: schemeAccent,
  dark2: schemeDark2,
  observable10: schemeObservable10,
  paired: schemePaired,
  pastel1: schemePastel1,
  set2: schemeSet2,
  set3: schemeSet3,
  tableau10: schemeTableau10,
} as const;

export const D3_SEQUENTIAL = {
  blues: interpolateBlues,
  greens: interpolateGreens,
  greys: interpolateGreys,
  oranges: interpolateOranges,
  purples: interpolatePurples,
  reds: interpolateReds,
  turbo: interpolateTurbo,
  viridis: interpolateViridis,
  inferno: interpolateInferno,
  magma: interpolateMagma,
  plasma: interpolatePlasma,
  cividis: interpolateCividis,
  warm: interpolateWarm,
  cool: interpolateCool,
  'cubehelix-default': interpolateCubehelixDefault,
} as const;

export const D3_DIVERGING = {
  brbg: interpolateBrBG,
  prgn: interpolatePRGn,
  piyg: interpolatePiYG,
  puor: interpolatePuOr,
  rdbu: interpolateRdBu,
  rdgy: interpolateRdGy,
  rdylbu: interpolateRdYlBu,
  rdylgn: interpolateRdYlGn,
  spectral: interpolateSpectral,
} as const;

export const D3_CYCLICAL = {
  rainbow: interpolateRainbow,
  sinebow: interpolateSinebow,
} as const;

export type CategoricalPalettePreset = keyof typeof D3_CATEGORICAL;
export type SequentialPalettePreset = keyof typeof D3_SEQUENTIAL;
export type DivergingPalettePreset = keyof typeof D3_DIVERGING;
export type CyclicalPalettePreset = keyof typeof D3_CYCLICAL;
export type D3PalettePreset =
  | CategoricalPalettePreset
  | SequentialPalettePreset
  | DivergingPalettePreset
  | CyclicalPalettePreset;

export interface D3PaletteChoice {
  value: D3PalettePreset;
  label: string;
  family: PaletteFamily;
}

export const D3_CATEGORICAL_CHOICES: D3PaletteChoice[] = [
  { value: 'category10', label: 'Category10', family: 'categorical' },
  { value: 'accent', label: 'Accent', family: 'categorical' },
  { value: 'dark2', label: 'Dark2', family: 'categorical' },
  { value: 'observable10', label: 'Observable10', family: 'categorical' },
  { value: 'paired', label: 'Paired', family: 'categorical' },
  { value: 'pastel1', label: 'Pastel1', family: 'categorical' },
  { value: 'set2', label: 'Set2', family: 'categorical' },
  { value: 'set3', label: 'Set3', family: 'categorical' },
  { value: 'tableau10', label: 'Tableau10', family: 'categorical' },
];

export const D3_SEQUENTIAL_CHOICES: D3PaletteChoice[] = [
  { value: 'blues', label: 'Blues', family: 'sequential' },
  { value: 'greens', label: 'Greens', family: 'sequential' },
  { value: 'greys', label: 'Greys', family: 'sequential' },
  { value: 'oranges', label: 'Oranges', family: 'sequential' },
  { value: 'purples', label: 'Purples', family: 'sequential' },
  { value: 'reds', label: 'Reds', family: 'sequential' },
  { value: 'turbo', label: 'Turbo', family: 'sequential' },
  { value: 'viridis', label: 'Viridis', family: 'sequential' },
  { value: 'inferno', label: 'Inferno', family: 'sequential' },
  { value: 'magma', label: 'Magma', family: 'sequential' },
  { value: 'plasma', label: 'Plasma', family: 'sequential' },
  { value: 'cividis', label: 'Cividis', family: 'sequential' },
  { value: 'warm', label: 'Warm', family: 'sequential' },
  { value: 'cool', label: 'Cool', family: 'sequential' },
  { value: 'cubehelix-default', label: 'Cubehelix Default', family: 'sequential' },
];

export const D3_DIVERGING_CHOICES: D3PaletteChoice[] = [
  { value: 'brbg', label: 'BrBG', family: 'diverging' },
  { value: 'prgn', label: 'PRGn', family: 'diverging' },
  { value: 'piyg', label: 'PiYG', family: 'diverging' },
  { value: 'puor', label: 'PuOr', family: 'diverging' },
  { value: 'rdbu', label: 'RdBu', family: 'diverging' },
  { value: 'rdgy', label: 'RdGy', family: 'diverging' },
  { value: 'rdylbu', label: 'RdYlBu', family: 'diverging' },
  { value: 'rdylgn', label: 'RdYlGn', family: 'diverging' },
  { value: 'spectral', label: 'Spectral', family: 'diverging' },
];

export const D3_CYCLICAL_CHOICES: D3PaletteChoice[] = [
  { value: 'rainbow', label: 'Rainbow', family: 'cyclical' },
  { value: 'sinebow', label: 'Sinebow', family: 'cyclical' },
];

export const D3_THEME_CHOICES: D3PaletteChoice[] = [
  ...D3_CATEGORICAL_CHOICES,
  ...D3_SEQUENTIAL_CHOICES,
  ...D3_DIVERGING_CHOICES,
  ...D3_CYCLICAL_CHOICES,
];

export const DEFAULT_CATEGORICAL_PRESET: CategoricalPalettePreset = 'category10';
export const DEFAULT_SEQUENTIAL_PRESET: SequentialPalettePreset = 'blues';
export const DEFAULT_DIVERGING_PRESET: DivergingPalettePreset = 'brbg';
export const DEFAULT_CYCLICAL_PRESET: CyclicalPalettePreset = 'rainbow';
export const DEFAULT_PALETTE_PRESET = DEFAULT_CATEGORICAL_PRESET;
export const DEFAULT_PALETTE = [...D3_CATEGORICAL[DEFAULT_CATEGORICAL_PRESET]].map(normalizeD3Color);

const CONTINUOUS_SAMPLE_COUNT = 32;
const FAMILY_CHOICES: Record<PaletteFamily, D3PaletteChoice[]> = {
  categorical: D3_CATEGORICAL_CHOICES,
  sequential: D3_SEQUENTIAL_CHOICES,
  diverging: D3_DIVERGING_CHOICES,
  cyclical: D3_CYCLICAL_CHOICES,
};

export interface ColorThemeState {
  version: 3;
  seriesPreset: D3PalettePreset;
  valuePreset: D3PalettePreset;
  seriesReversed: boolean;
  valueReversed: boolean;
}

export const DEFAULT_COLOR_THEME: ColorThemeState = {
  version: 3,
  seriesPreset: DEFAULT_CATEGORICAL_PRESET,
  valuePreset: DEFAULT_SEQUENTIAL_PRESET,
  seriesReversed: false,
  valueReversed: false,
};

/** 현재 차트가 드롭다운에서 가장 먼저 보여 줄 권장 family. */
export function paletteFamilyForChartType(chartType: unknown): 'categorical' | 'sequential' {
  return chartType === 'heatmap' || chartType === 'map' ? 'sequential' : 'categorical';
}

export function paletteFamilyOrderForChartType(chartType: unknown): PaletteFamily[] {
  return paletteFamilyForChartType(chartType) === 'sequential'
    ? ['sequential', 'diverging', 'categorical', 'cyclical']
    : ['categorical', 'sequential', 'diverging', 'cyclical'];
}

export function paletteChoicesForChartType(chartType: unknown): D3PaletteChoice[] {
  return paletteFamilyOrderForChartType(chartType).flatMap((family) => FAMILY_CHOICES[family]);
}

export function paletteFamilyOfPreset(preset: unknown): PaletteFamily | null {
  if (typeof preset !== 'string') return null;
  if (preset in D3_CATEGORICAL) return 'categorical';
  if (preset in D3_SEQUENTIAL) return 'sequential';
  if (preset in D3_DIVERGING) return 'diverging';
  if (preset in D3_CYCLICAL) return 'cyclical';
  return null;
}

export function isPalettePresetForFamily(preset: unknown, family: PaletteFamily): preset is D3PalettePreset {
  return paletteFamilyOfPreset(preset) === family;
}

export function isD3PalettePreset(preset: unknown): preset is D3PalettePreset {
  return paletteFamilyOfPreset(preset) != null;
}

export function isContinuousPalettePreset(preset: unknown): boolean {
  const family = paletteFamilyOfPreset(preset);
  return family === 'sequential' || family === 'diverging' || family === 'cyclical';
}

export function defaultPalettePresetForChartType(chartType: unknown): D3PalettePreset {
  return paletteFamilyForChartType(chartType) === 'sequential'
    ? DEFAULT_SEQUENTIAL_PRESET
    : DEFAULT_CATEGORICAL_PRESET;
}

export function d3ThemeColorAt(preset: unknown, position: number): string {
  const normalizedPosition = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));
  if (typeof preset === 'string' && preset in D3_SEQUENTIAL) {
    return normalizeD3Color(D3_SEQUENTIAL[preset as SequentialPalettePreset](normalizedPosition));
  }
  if (typeof preset === 'string' && preset in D3_DIVERGING) {
    return normalizeD3Color(D3_DIVERGING[preset as DivergingPalettePreset](normalizedPosition));
  }
  if (typeof preset === 'string' && preset in D3_CYCLICAL) {
    return normalizeD3Color(D3_CYCLICAL[preset as CyclicalPalettePreset](normalizedPosition));
  }
  const colors = d3Palette(preset);
  const index = Math.min(colors.length - 1, Math.floor(normalizedPosition * colors.length));
  return colors[Math.max(0, index)] ?? DEFAULT_PALETTE[0];
}

/**
 * ECharts/JSON 경계에서 사용할 색상 배열을 D3 원본으로부터 구체화한다.
 * 범주형은 D3 scheme 원본 길이를 유지하고 연속형은 요청한 정밀도로 동적 샘플링한다.
 */
export function d3Palette(preset: unknown, sampleCount = CONTINUOUS_SAMPLE_COUNT): string[] {
  if (typeof preset === 'string' && preset in D3_CATEGORICAL) {
    return [...D3_CATEGORICAL[preset as CategoricalPalettePreset]].map(normalizeD3Color);
  }
  const family = paletteFamilyOfPreset(preset);
  if (family === 'sequential' || family === 'diverging' || family === 'cyclical') {
    const count = Math.max(2, Math.round(sampleCount));
    return Array.from({ length: count }, (_unused, index) => (
      d3ThemeColorAt(preset, index / (count - 1))
    ));
  }
  return [...DEFAULT_PALETTE];
}

export function d3PaletteForChartType(chartType: unknown, preset: unknown): string[] {
  return d3Palette(isD3PalettePreset(preset) ? preset : defaultPalettePresetForChartType(chartType));
}

export function normalizeColorTheme(value: unknown, activePreset?: unknown, activeChartType?: unknown): ColorThemeState {
  const source = value != null && typeof value === 'object'
    ? value as Partial<ColorThemeState>
    : {};
  const current = source.version === 3 ? source : {};
  const theme: ColorThemeState = {
    version: 3,
    seriesPreset: isD3PalettePreset(current.seriesPreset) ? current.seriesPreset : DEFAULT_CATEGORICAL_PRESET,
    valuePreset: isD3PalettePreset(current.valuePreset) ? current.valuePreset : DEFAULT_SEQUENTIAL_PRESET,
    seriesReversed: current.seriesReversed === true,
    valueReversed: current.valueReversed === true,
  };
  if (isD3PalettePreset(activePreset)) {
    if (paletteFamilyForChartType(activeChartType) === 'sequential') theme.valuePreset = activePreset;
    else theme.seriesPreset = activePreset;
  }
  return theme;
}

/** 테마는 자동 색상만 바꾸며 colorMap/itemColorOverrides 같은 명시적 지정은 유지한다. */
export function applyPalettePreset(
  options: Record<string, any>,
  chartType: PaletteChartType,
  preset: unknown,
): Record<string, any> {
  const next = structuredClone(options);
  const selected = isD3PalettePreset(preset) ? preset : defaultPalettePresetForChartType(chartType);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, chartType);
  if (paletteFamilyForChartType(chartType) === 'sequential') theme.valuePreset = selected;
  else theme.seriesPreset = selected;
  next.colorTheme = theme;
  next.palettePreset = selected;
  next.palette = d3Palette(selected);
  next.paletteActiveIndex = 0;
  next.paletteReversed = isContinuousPalettePreset(selected)
    ? (paletteFamilyForChartType(chartType) === 'sequential' ? theme.valueReversed : theme.seriesReversed)
    : false;
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
  if (paletteFamilyForChartType(chartType) === 'sequential') theme.valueReversed = reversed;
  else theme.seriesReversed = reversed;
  next.colorTheme = theme;
  next.paletteReversed = isContinuousPalettePreset(next.palettePreset) && reversed;
  return next;
}

/** 대분류 전환 시 차트군별 마지막 테마를 기억하고 대상 차트군의 테마를 복원한다. */
export function switchPaletteForChartType(
  options: Record<string, any>,
  from: PaletteChartType,
  to: PaletteChartType,
): Record<string, any> {
  const next = structuredClone(options);
  const fromFamily = paletteFamilyForChartType(from);
  const toFamily = paletteFamilyForChartType(to);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, from);
  if (isD3PalettePreset(next.palettePreset)) {
    if (fromFamily === 'sequential') theme.valuePreset = next.palettePreset;
    else theme.seriesPreset = next.palettePreset;
  }
  if (fromFamily === 'sequential') theme.valueReversed = next.paletteReversed === true;
  else theme.seriesReversed = next.paletteReversed === true;

  next.colorTheme = theme;
  if (fromFamily !== toFamily) {
    const targetPreset = toFamily === 'sequential' ? theme.valuePreset : theme.seriesPreset;
    next.palettePreset = targetPreset;
    next.palette = d3Palette(targetPreset);
    next.paletteActiveIndex = 0;
    next.autoColorMap = {};
    next.paletteReversed = isContinuousPalettePreset(targetPreset)
      && (toFamily === 'sequential' ? theme.valueReversed : theme.seriesReversed);
  } else if (!isD3PalettePreset(next.palettePreset)) {
    const targetPreset = defaultPalettePresetForChartType(to);
    next.palettePreset = targetPreset;
    next.palette = d3Palette(targetPreset);
    next.paletteReversed = false;
    next.autoColorMap = {};
  }
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

  const used = new Set(Object.values(resolved).map((color) => color.toUpperCase()));
  names.forEach((name, index) => {
    if (resolved[name]) return;
    if (index < base.length && !used.has(base[index])) {
      resolved[name] = base[index];
      used.add(base[index]);
      return;
    }
    let attempt = 0;
    let color: string;
    do {
      const hash = fnv1a(`${name}:${attempt}`);
      const hue = (hash + Math.round(index * 137.508)) % 360;
      const saturation = 62 + ((hash >>> 9) % 19);
      const lightness = 38 + ((hash >>> 17) % 23);
      color = hslToHex(hue, saturation, lightness);
      attempt += 1;
    } while (used.has(color) && attempt < 720);
    resolved[name] = color;
    used.add(color);
  });
  return resolved;
}

function normalizeD3Color(value: string): string {
  return parseD3Color(value)?.formatHex().toUpperCase() ?? schemeCategory10[0].toUpperCase();
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

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
