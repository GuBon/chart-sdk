export type ItemColorKind =
  | 'cartesian'
  | 'scatter'
  | 'pie'
  | 'boxplot'
  | 'heatmap'
  | 'map'
  | 'geoscatter';

export type ItemColorDimension = string | number | null;

export interface ItemColorTarget {
  kind: ItemColorKind;
  seriesName: string;
  dimensions: ItemColorDimension[];
  occurrence: number;
}

export interface ItemColorOverride extends ItemColorTarget {
  color: string;
}

export type ColorSelection =
  | {
      scope: 'series';
      seriesName: string;
      label: string;
    }
  | ({
      scope: 'item';
      label: string;
      renderedColor?: string;
      seriesIndex?: number;
      dataIndex?: number;
    } & ItemColorTarget);

const ITEM_COLOR_KINDS = new Set<ItemColorKind>([
  'cartesian',
  'scatter',
  'pie',
  'boxplot',
  'heatmap',
  'map',
  'geoscatter',
]);

export const SINGLE_ITEM_COLOR_SERIES: Partial<Record<ItemColorKind, string>> = {
  pie: '__pie__',
  boxplot: '__boxplot__',
  heatmap: '__heatmap__',
  map: '__map__',
  geoscatter: '__geoscatter__',
};

export function itemColorSeriesKey(kind: ItemColorKind, displayedSeriesName: unknown): string {
  return SINGLE_ITEM_COLOR_SERIES[kind]
    ?? (typeof displayedSeriesName === 'string' ? displayedSeriesName : String(displayedSeriesName ?? ''));
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function itemColorTargetKey(target: ItemColorTarget): string {
  return JSON.stringify([
    target.kind,
    target.seriesName,
    target.dimensions.map(canonicalDimension),
    normalizeOccurrence(target.occurrence),
  ]);
}

export function normalizeItemColorOverrides(value: unknown): ItemColorOverride[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Map<string, ItemColorOverride>();
  for (const item of value) {
    const override = normalizeOverride(item);
    if (!override) continue;
    normalized.set(itemColorTargetKey(override), override);
  }
  return [...normalized.values()];
}

export function findItemColorOverride(
  value: unknown,
  target: ItemColorTarget,
): ItemColorOverride | undefined {
  const key = itemColorTargetKey(target);
  return normalizeItemColorOverrides(value).find((item) => itemColorTargetKey(item) === key);
}

export function upsertItemColorOverride(
  value: unknown,
  target: ItemColorTarget,
  color: unknown,
): ItemColorOverride[] {
  const normalizedColor = normalizeHexColor(color);
  if (!normalizedColor) return normalizeItemColorOverrides(value);
  const override: ItemColorOverride = {
    kind: target.kind,
    seriesName: target.seriesName,
    dimensions: target.dimensions.map(normalizeDimension),
    occurrence: normalizeOccurrence(target.occurrence),
    color: normalizedColor,
  };
  const key = itemColorTargetKey(override);
  const next = normalizeItemColorOverrides(value);
  const index = next.findIndex((item) => itemColorTargetKey(item) === key);
  if (index >= 0) next[index] = override;
  else next.push(override);
  return next;
}

export function removeItemColorOverride(
  value: unknown,
  target: ItemColorTarget,
): ItemColorOverride[] {
  const key = itemColorTargetKey(target);
  return normalizeItemColorOverrides(value)
    .filter((item) => itemColorTargetKey(item) !== key);
}

export function isItemColorSelection(
  selection: ColorSelection | null | undefined,
): selection is Extract<ColorSelection, { scope: 'item' }> {
  return selection?.scope === 'item';
}

function normalizeOverride(value: unknown): ItemColorOverride | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== 'string' || !ITEM_COLOR_KINDS.has(candidate.kind as ItemColorKind)) return null;
  if (typeof candidate.seriesName !== 'string') return null;
  if (!Array.isArray(candidate.dimensions)) return null;
  const dimensions: ItemColorDimension[] = [];
  for (const dimension of candidate.dimensions) {
    if (dimension !== null && typeof dimension !== 'string' && typeof dimension !== 'number') return null;
    if (typeof dimension === 'number' && !Number.isFinite(dimension)) return null;
    dimensions.push(normalizeDimension(dimension));
  }
  const color = normalizeHexColor(candidate.color);
  if (!color) return null;
  return {
    kind: candidate.kind as ItemColorKind,
    seriesName: candidate.seriesName,
    dimensions,
    occurrence: normalizeOccurrence(candidate.occurrence),
    color,
  };
}

function normalizeDimension(value: ItemColorDimension): ItemColorDimension {
  if (typeof value !== 'number') return value;
  return Object.is(value, -0) ? 0 : value;
}

function normalizeOccurrence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function canonicalDimension(value: ItemColorDimension): [string, string] {
  if (value === null) return ['null', ''];
  if (typeof value === 'number') return ['number', canonicalNumber(value)];
  return ['string', value];
}

function canonicalNumber(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
