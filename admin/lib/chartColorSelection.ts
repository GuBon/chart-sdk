import type { MajorType } from '@chartsdk/chart-options';
import {
  itemColorSeriesKey,
  itemColorTargetKey,
  normalizeHexColor,
  type ColorSelection,
  type ItemColorDimension,
  type ItemColorKind,
  type ItemColorTarget,
} from '@chartsdk/chart-options/colorOverrides';

export interface ChartColorClick {
  componentType?: unknown;
  seriesType?: unknown;
  seriesIndex?: unknown;
  seriesName?: unknown;
  dataIndex?: unknown;
  name?: unknown;
  value?: unknown;
  color?: unknown;
}

export interface LocatedColorItem {
  seriesIndex: number;
  dataIndex: number;
}

export function staticColorSelections(
  chartType: MajorType,
  columns: { name: string }[],
  rows: unknown[][],
): ColorSelection[] {
  if (chartType === 'pie') {
    const seen = new Set<string>();
    const selections: ColorSelection[] = [];
    for (const row of rows) {
      const dimension = colorDimension(row[0]);
      const key = JSON.stringify(dimension);
      if (seen.has(key)) continue;
      seen.add(key);
      selections.push({
        scope: 'item',
        kind: 'pie',
        seriesName: itemColorSeriesKey('pie', ''),
        dimensions: [dimension],
        occurrence: 0,
        label: displayDimension(dimension),
      });
    }
    return selections;
  }
  if (chartType === 'boxplot') {
    const name = columns[1]?.name;
    return name ? [{ scope: 'series', seriesName: name, label: name }] : [];
  }
  if (chartType === 'bar' || chartType === 'line' || chartType === 'scatter') {
    return columns.slice(1).map((column) => ({
      scope: 'series',
      seriesName: column.name,
      label: column.name,
    }));
  }
  return [];
}

export function colorSelectionFromChartClick(
  chartType: MajorType,
  click: ChartColorClick,
  option: Record<string, unknown>,
): Extract<ColorSelection, { scope: 'item' }> | null {
  if (click.componentType !== 'series') return null;
  if (typeof click.seriesIndex !== 'number' || !Number.isInteger(click.seriesIndex)) return null;
  if (typeof click.dataIndex !== 'number' || !Number.isInteger(click.dataIndex)) return null;
  const identity = itemTargetAt(option, chartType, click.seriesIndex, click.dataIndex);
  if (!identity) return null;
  return {
    scope: 'item',
    ...identity,
    label: itemSelectionLabel(identity.kind, displayedSeriesName(option, click.seriesIndex), identity.dimensions),
    renderedColor: cssColorToHex(click.color) ?? undefined,
    seriesIndex: click.seriesIndex,
    dataIndex: click.dataIndex,
  };
}

export function locateColorSelection(
  option: Record<string, unknown>,
  chartType: MajorType,
  selection: ColorSelection | null | undefined,
): LocatedColorItem | null {
  if (selection?.scope !== 'item') return null;
  if (colorKind(chartType) !== selection.kind) return null;
  const targetKey = itemColorTargetKey(selection);
  const series = optionSeries(option);
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const itemSeriesKey = itemColorSeriesKey(selection.kind, series[seriesIndex]?.name);
    if (itemSeriesKey !== selection.seriesName) continue;
    const data = seriesData(series[seriesIndex]);
    // occurrence 를 시리즈당 한 번의 순회로 누적 — 항목마다 이전 인덱스를 재스캔하지 않는다.
    const occurrences = new Map<string, number>();
    for (let dataIndex = 0; dataIndex < data.length; dataIndex++) {
      const dimensions = itemDimensions(option, selection.kind, series[seriesIndex], dataIndex);
      if (!dimensions) continue;
      const base: ItemColorTarget = { kind: selection.kind, seriesName: itemSeriesKey, dimensions, occurrence: 0 };
      const baseKey = itemColorTargetKey(base);
      const occurrence = occurrences.get(baseKey) ?? 0;
      occurrences.set(baseKey, occurrence + 1);
      if (itemColorTargetKey({ ...base, occurrence }) === targetKey) return { seriesIndex, dataIndex };
    }
  }
  return null;
}

export function itemTargetAt(
  option: Record<string, unknown>,
  chartType: MajorType,
  seriesIndex: number,
  dataIndex: number,
): ItemColorTarget | null {
  const kind = colorKind(chartType);
  if (!kind) return null;
  const series = optionSeries(option)[seriesIndex];
  if (!series) return null;
  const data = seriesData(series);
  if (dataIndex < 0 || dataIndex >= data.length) return null;
  const dimensions = itemDimensions(option, kind, series, dataIndex);
  if (!dimensions) return null;
  const seriesName = itemColorSeriesKey(kind, series.name);
  const baseTarget: ItemColorTarget = { kind, seriesName, dimensions, occurrence: 0 };
  const baseKey = itemColorTargetKey(baseTarget);
  let occurrence = 0;
  for (let index = 0; index < dataIndex; index++) {
    const previousDimensions = itemDimensions(option, kind, series, index);
    if (!previousDimensions) continue;
    if (itemColorTargetKey({ ...baseTarget, dimensions: previousDimensions }) === baseKey) occurrence++;
  }
  return { ...baseTarget, occurrence };
}

export function cssColorToHex(value: unknown): string | null {
  const direct = normalizeHexColor(value);
  if (direct) return direct;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (!match) return null;
  const channels = match.slice(1, 4).map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function colorKind(chartType: MajorType): ItemColorKind | null {
  if (chartType === 'bar' || chartType === 'line') return 'cartesian';
  return chartType;
}

function itemDimensions(
  option: Record<string, unknown>,
  kind: ItemColorKind,
  series: Record<string, unknown>,
  dataIndex: number,
): ItemColorDimension[] | null {
  const dataItem = seriesData(series)[dataIndex];
  const value = dataValue(dataItem);
  switch (kind) {
    case 'cartesian':
    case 'boxplot': {
      const category = categoryAt(option, series, dataIndex);
      return category === undefined ? null : [colorDimension(category)];
    }
    case 'scatter': {
      const values = Array.isArray(value) ? value : [];
      return values.length > 0 ? [colorDimension(values[0]), colorDimension(values[1])] : null;
    }
    case 'pie':
    case 'map': {
      const name = dataName(dataItem);
      return name === undefined ? null : [colorDimension(name)];
    }
    case 'heatmap': {
      const values = Array.isArray(value) ? value : [];
      const xIndex = numericIndex(values[0]);
      const yIndex = numericIndex(values[1]);
      if (xIndex == null || yIndex == null) return null;
      const xAxis = axisAt(option.xAxis, numericIndex(series.xAxisIndex) ?? 0);
      const yAxis = axisAt(option.yAxis, numericIndex(series.yAxisIndex) ?? 0);
      const x = axisDataAt(xAxis, xIndex);
      const y = axisDataAt(yAxis, yIndex);
      return x === undefined || y === undefined ? null : [colorDimension(x), colorDimension(y)];
    }
    case 'geoscatter': {
      const values = Array.isArray(value) ? value : [];
      if (typeof values[0] !== 'number' || typeof values[1] !== 'number') return null;
      return [roundCoordinate(values[0]), roundCoordinate(values[1])];
    }
  }
}

function itemSelectionLabel(
  kind: ItemColorKind,
  seriesName: string,
  dimensions: ItemColorDimension[],
): string {
  switch (kind) {
    case 'cartesian':
      return `${seriesName} · ${displayDimension(dimensions[0])}`;
    case 'scatter':
      return `${seriesName} · ${displayDimension(dimensions[0])}, ${displayDimension(dimensions[1])}`;
    case 'heatmap':
      return `${displayDimension(dimensions[1])} · ${displayDimension(dimensions[0])}`;
    case 'geoscatter':
      return `${displayDimension(dimensions[0])}, ${displayDimension(dimensions[1])}`;
    default:
      return displayDimension(dimensions[0]);
  }
}

function categoryAt(
  option: Record<string, unknown>,
  series: Record<string, unknown>,
  dataIndex: number,
): unknown {
  const xAxis = axisAt(option.xAxis, numericIndex(series.xAxisIndex) ?? 0);
  if (xAxis?.type === 'category') return axisDataAt(xAxis, dataIndex);
  const yAxis = axisAt(option.yAxis, numericIndex(series.yAxisIndex) ?? 0);
  if (yAxis?.type === 'category') return axisDataAt(yAxis, dataIndex);
  return undefined;
}

function optionSeries(option: Record<string, unknown>): Record<string, unknown>[] {
  return asObjectArray(option.series);
}

function seriesData(series: Record<string, unknown>): unknown[] {
  return Array.isArray(series.data) ? series.data : [];
}

function displayedSeriesName(option: Record<string, unknown>, seriesIndex: number): string {
  const name = optionSeries(option)[seriesIndex]?.name;
  return typeof name === 'string' ? name : '';
}

function dataValue(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).value
    : value;
}

function dataName(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).name
    : undefined;
}

function axisAt(value: unknown, index: number): Record<string, unknown> | null {
  const axes = asObjectArray(value);
  return axes[index] ?? axes[0] ?? null;
}

function axisDataAt(axis: Record<string, unknown> | null, index: number): unknown {
  if (!axis || !Array.isArray(axis.data)) return undefined;
  const value = axis.data[index];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function numericIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function colorDimension(value: unknown): ItemColorDimension {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  return String(value);
}

function displayDimension(value: ItemColorDimension | undefined): string {
  if (value == null) return '없음';
  return typeof value === 'number' ? String(value) : value;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
