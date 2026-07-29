/**
 * CARTOColors palettes (CC BY 4.0).
 * Source: https://github.com/CartoDB/CartoColor
 *
 * CARTO의 분류(qualitative/sequential)를 그대로 보존하고, 어떤 분류를 노출할지만
 * ChartSDK의 차트 대분류 정책으로 결정한다. 데이터 값의 의미는 추론하지 않는다.
 */
export const CARTO_QUALITATIVE = {
  safe: ['#88CCEE', '#CC6677', '#DDCC77', '#117733', '#332288', '#AA4499', '#44AA99', '#999933', '#882255', '#661100', '#6699CC', '#888888'],
  antique: ['#855C75', '#D9AF6B', '#AF6458', '#736F4C', '#526A83', '#625377', '#68855C', '#9C9C5E', '#A06177', '#8C785D', '#467378', '#7C7C7C'],
  bold: ['#7F3C8D', '#11A579', '#3969AC', '#F2B701', '#E73F74', '#80BA5A', '#E68310', '#008695', '#CF1C90', '#F97B72', '#4B4B8F', '#A5AA99'],
  pastel: ['#66C5CC', '#F6CF71', '#F89C74', '#DCB0F2', '#87C55F', '#9EB9F3', '#FE88B1', '#C9DB74', '#8BE0A4', '#B497E7', '#D3B484', '#B3B3B3'],
  prism: ['#5F4690', '#1D6996', '#38A6A5', '#0F8554', '#73AF48', '#EDAD08', '#E17C05', '#CC503E', '#94346E', '#6F4070', '#994E95', '#666666'],
  vivid: ['#E58606', '#5D69B1', '#52BCA3', '#99C945', '#CC61B0', '#24796C', '#DAA51B', '#2F8AC4', '#764E9F', '#ED645A', '#CC3A8E', '#A5AA99'],
} as const;

/** 공식 CARTOColors sequential 팔레트의 7단계(낮은 값 → 높은 값) 색상. */
export const CARTO_SEQUENTIAL = {
  burg: ['#FFC6C4', '#F4A3A8', '#E38191', '#CC607D', '#AD466C', '#8B3058', '#672044'],
  burgyl: ['#FBE6C5', '#F5BA98', '#EE8A82', '#DC7176', '#C8586C', '#9C3F5D', '#70284A'],
  redor: ['#F6D2A9', '#F5B78E', '#F19C7C', '#EA8171', '#DD686C', '#CA5268', '#B13F64'],
  oryel: ['#ECDA9A', '#EFC47E', '#F3AD6A', '#F7945D', '#F97B57', '#F66356', '#EE4D5A'],
  peach: ['#FDE0C5', '#FACBA6', '#F8B58B', '#F59E72', '#F2855D', '#EF6A4C', '#EB4A40'],
  pinkyl: ['#FEF6B5', '#FFDD9A', '#FFC285', '#FFA679', '#FA8A76', '#F16D7A', '#E15383'],
  mint: ['#E4F1E1', '#B4D9CC', '#89C0B6', '#63A6A0', '#448C8A', '#287274', '#0D585F'],
  blugrn: ['#C4E6C3', '#96D2A4', '#6DBC90', '#4DA284', '#36877A', '#266B6E', '#1D4F60'],
  darkmint: ['#D2FBD4', '#A5DBC2', '#7BBCB0', '#559C9E', '#3A7C89', '#235D72', '#123F5A'],
  emrld: ['#D3F2A3', '#97E196', '#6CC08B', '#4C9B82', '#217A79', '#105965', '#074050'],
  bluyl: ['#F7FEAE', '#B7E6A5', '#7CCBA2', '#46AEA0', '#089099', '#00718B', '#045275'],
  teal: ['#D1EEEA', '#A8DBD9', '#85C4C9', '#68ABB8', '#4F90A6', '#3B738F', '#2A5674'],
  tealgrn: ['#B0F2BC', '#89E8AC', '#67DBA5', '#4CC8A3', '#38B2A3', '#2C98A0', '#257D98'],
  purp: ['#F3E0F7', '#E4C7F1', '#D1AFE8', '#B998DD', '#9F82CE', '#826DBA', '#63589F'],
  purpor: ['#F9DDDA', '#F2B9C4', '#E597B9', '#CE78B3', '#AD5FAD', '#834BA0', '#573B88'],
  sunset: ['#F3E79B', '#FAC484', '#F8A07E', '#EB7F86', '#CE6693', '#A059A0', '#5C53A5'],
  magenta: ['#F3CBD3', '#EAA9BD', '#DD88AC', '#CA699D', '#B14D8E', '#91357D', '#6C2167'],
  sunsetdark: ['#FCDE9C', '#FAA476', '#F0746E', '#E34F6F', '#DC3977', '#B9257A', '#7C1D6F'],
  brwnyl: ['#EDE5CF', '#E0C2A2', '#D39C83', '#C1766F', '#A65461', '#813753', '#541F3F'],
} as const;

export type PaletteChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'boxplot' | 'heatmap' | 'map' | 'geoscatter';
export type PaletteFamily = 'qualitative' | 'sequential';
export type QualitativePalettePreset = keyof typeof CARTO_QUALITATIVE;
export type SequentialPalettePreset = keyof typeof CARTO_SEQUENTIAL;
export type CartoPalettePreset = QualitativePalettePreset | SequentialPalettePreset;

export const DEFAULT_QUALITATIVE_PRESET: QualitativePalettePreset = 'safe';
export const DEFAULT_SEQUENTIAL_PRESET: SequentialPalettePreset = 'teal';
/** 기존 import 호환. 범주형 기본값을 뜻한다. */
export const DEFAULT_PALETTE_PRESET = DEFAULT_QUALITATIVE_PRESET;
export const DEFAULT_PALETTE = [...CARTO_QUALITATIVE[DEFAULT_QUALITATIVE_PRESET]];

export const CARTO_QUALITATIVE_CHOICES: { value: QualitativePalettePreset; label: string }[] = [
  { value: 'safe', label: 'Safe' },
  { value: 'bold', label: 'Bold' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'prism', label: 'Prism' },
  { value: 'antique', label: 'Antique' },
  { value: 'pastel', label: 'Pastel' },
];

export const CARTO_SEQUENTIAL_CHOICES: { value: SequentialPalettePreset; label: string }[] = [
  { value: 'burg', label: 'Burg' },
  { value: 'burgyl', label: 'BurgYL' },
  { value: 'redor', label: 'RedOr' },
  { value: 'oryel', label: 'OrYel' },
  { value: 'peach', label: 'Peach' },
  { value: 'pinkyl', label: 'PinkYl' },
  { value: 'mint', label: 'Mint' },
  { value: 'blugrn', label: 'BluGrn' },
  { value: 'darkmint', label: 'DarkMint' },
  { value: 'emrld', label: 'Emrld' },
  { value: 'bluyl', label: 'BluYl' },
  { value: 'teal', label: 'Teal' },
  { value: 'tealgrn', label: 'TealGrn' },
  { value: 'purp', label: 'Purp' },
  { value: 'purpor', label: 'PurpOr' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'magenta', label: 'Magenta' },
  { value: 'sunsetdark', label: 'SunsetDark' },
  { value: 'brwnyl', label: 'BrownYl' },
];

export interface ColorThemeState {
  version: 2;
  qualitativePreset: QualitativePalettePreset;
  sequentialPreset: SequentialPalettePreset;
  sequentialReversed: boolean;
}

export const DEFAULT_COLOR_THEME: ColorThemeState = {
  version: 2,
  qualitativePreset: DEFAULT_QUALITATIVE_PRESET,
  sequentialPreset: DEFAULT_SEQUENTIAL_PRESET,
  sequentialReversed: false,
};

export function paletteFamilyForChartType(chartType: unknown): PaletteFamily {
  return chartType === 'heatmap' || chartType === 'map' ? 'sequential' : 'qualitative';
}

export function paletteChoicesForChartType(chartType: unknown): { value: CartoPalettePreset; label: string }[] {
  const qualitative = [...CARTO_QUALITATIVE_CHOICES];
  const sequential = [...CARTO_SEQUENTIAL_CHOICES];
  return paletteFamilyForChartType(chartType) === 'sequential'
    ? [...sequential, ...qualitative]
    : [...qualitative, ...sequential];
}

export function isPalettePresetForFamily(preset: unknown, family: PaletteFamily): preset is CartoPalettePreset {
  if (typeof preset !== 'string') return false;
  return family === 'sequential' ? preset in CARTO_SEQUENTIAL : preset in CARTO_QUALITATIVE;
}

export function defaultPalettePresetForChartType(chartType: unknown): CartoPalettePreset {
  return paletteFamilyForChartType(chartType) === 'sequential'
    ? DEFAULT_SEQUENTIAL_PRESET
    : DEFAULT_QUALITATIVE_PRESET;
}

export function cartoPalette(preset: unknown): string[] {
  if (typeof preset === 'string' && preset in CARTO_QUALITATIVE) {
    return [...CARTO_QUALITATIVE[preset as QualitativePalettePreset]];
  }
  if (typeof preset === 'string' && preset in CARTO_SEQUENTIAL) {
    return [...CARTO_SEQUENTIAL[preset as SequentialPalettePreset]];
  }
  return [...CARTO_QUALITATIVE[DEFAULT_QUALITATIVE_PRESET]];
}

export function cartoPaletteForChartType(chartType: unknown, preset: unknown): string[] {
  return cartoPalette(
    isPalettePresetForFamily(preset, 'qualitative') || isPalettePresetForFamily(preset, 'sequential')
    ? preset
    : defaultPalettePresetForChartType(chartType),
  );
}

export function normalizeColorTheme(value: unknown, activePreset?: unknown, activeChartType?: unknown): ColorThemeState {
  const source = value != null && typeof value === 'object'
    ? value as Partial<ColorThemeState>
    : {};
  const family = paletteFamilyForChartType(activeChartType);
  const qualitativePreset = isPalettePresetForFamily(source.qualitativePreset, 'qualitative')
    ? source.qualitativePreset as QualitativePalettePreset
    : family === 'qualitative' && isPalettePresetForFamily(activePreset, 'qualitative')
      ? activePreset as QualitativePalettePreset
      : DEFAULT_QUALITATIVE_PRESET;
  const sequentialPreset = isPalettePresetForFamily(source.sequentialPreset, 'sequential')
    ? source.sequentialPreset as SequentialPalettePreset
    : family === 'sequential' && isPalettePresetForFamily(activePreset, 'sequential')
      ? activePreset as SequentialPalettePreset
      : DEFAULT_SEQUENTIAL_PRESET;
  return {
    version: 2,
    qualitativePreset,
    sequentialPreset,
    sequentialReversed: source.sequentialReversed === true,
  };
}

/**
 * 테마 선택은 기본 팔레트만 바꾼다. colorMap/itemColorOverrides 같은 명시적
 * 지정은 유지되어, '지정 해제' 시 새 기본 팔레트로 돌아간다.
 */
export function applyPalettePreset(
  options: Record<string, any>,
  chartType: PaletteChartType,
  preset: unknown,
): Record<string, any> {
  const next = structuredClone(options);
  const chartFamily = paletteFamilyForChartType(chartType);
  const selectedFamily: PaletteFamily = isPalettePresetForFamily(preset, 'qualitative')
    ? 'qualitative'
    : isPalettePresetForFamily(preset, 'sequential')
      ? 'sequential'
      : chartFamily;
  const selected = isPalettePresetForFamily(preset, selectedFamily)
    ? preset
    : defaultPalettePresetForChartType(chartType);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, chartType);
  if (selectedFamily === 'qualitative') theme.qualitativePreset = selected as QualitativePalettePreset;
  else theme.sequentialPreset = selected as SequentialPalettePreset;
  next.colorTheme = theme;
  next.palettePreset = selected;
  next.palette = cartoPalette(selected);
  next.paletteActiveIndex = 0;
  next.paletteReversed = chartFamily === 'sequential' && selectedFamily === 'sequential'
    ? theme.sequentialReversed
    : false;
  next.autoColorMap = {};
  return next;
}

export function applySequentialPaletteDirection(
  options: Record<string, any>,
  chartType: PaletteChartType,
  reversed: boolean,
): Record<string, any> {
  let next = structuredClone(options);
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, chartType);
  if (
    paletteFamilyForChartType(chartType) === 'sequential'
    && !isPalettePresetForFamily(next.palettePreset, 'sequential')
  ) {
    // 구형 범주형 지도 테마에서 방향을 처음 조정하면 기본 순차형 테마로 명시적으로 전환한다.
    next = applyPalettePreset(next, chartType, theme.sequentialPreset);
  }
  theme.sequentialReversed = reversed;
  next.colorTheme = theme;
  next.paletteReversed = paletteFamilyForChartType(chartType) === 'sequential' && reversed;
  return next;
}

/** 대분류 전환 시 분류별 마지막 선택을 기억하고 대상 분류의 팔레트를 복원한다. */
export function switchPaletteForChartType(
  options: Record<string, any>,
  from: PaletteChartType,
  to: PaletteChartType,
): Record<string, any> {
  const next = structuredClone(options);
  const fromFamily = paletteFamilyForChartType(from);
  const toFamily = paletteFamilyForChartType(to);
  const hasCurrentContract = next.colorTheme?.version === 2;
  if (fromFamily === toFamily && !hasCurrentContract) return next;
  const theme = normalizeColorTheme(next.colorTheme, next.palettePreset, from);
  if (isPalettePresetForFamily(next.palettePreset, fromFamily)) {
    if (fromFamily === 'qualitative') theme.qualitativePreset = next.palettePreset as QualitativePalettePreset;
    else theme.sequentialPreset = next.palettePreset as SequentialPalettePreset;
  }
  if (fromFamily === 'sequential') theme.sequentialReversed = next.paletteReversed === true;

  next.colorTheme = theme;
  if (fromFamily !== toFamily) {
    const targetPreset = toFamily === 'sequential' ? theme.sequentialPreset : theme.qualitativePreset;
    next.palettePreset = targetPreset;
    next.palette = cartoPalette(targetPreset);
    next.paletteActiveIndex = 0;
    next.autoColorMap = {};
  }
  next.paletteReversed = toFamily === 'sequential' ? theme.sequentialReversed : false;
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
