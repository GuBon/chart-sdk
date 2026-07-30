import type { MajorType } from './optionRegistry';
import type { TooltipFieldDescriptor } from './tooltip';

export type ValueFormat = 'raw' | 'comma' | 'decimal0' | 'decimal1' | 'percent';

type FormatMetadata = { tooltip?: ValueFormat; yAxis?: ValueFormat; unit?: string };
type TooltipMetadata = {
  mode?: 'custom' | 'fields';
  chartType?: MajorType;
  template?: string;
  fields?: TooltipFieldDescriptor[];
  showSeriesColor?: boolean;
};
type VerticalAxisRole = 'x' | 'y';

type TooltipParams = {
  seriesId?: unknown;
  seriesName?: unknown;
  name?: unknown;
  value?: unknown;
  percent?: unknown;
  marker?: unknown;
  axisValueLabel?: unknown;
};

/** Server JSON metadata를 ECharts formatter 함수로 복원하고 내부 키를 제거한다. */
export function hydrateValueFormat(option: Record<string, any>): Record<string, any> {
  const metadata = option.__chartsdkValueFormat as FormatMetadata | undefined;
  const tooltipMetadata = option.__chartsdkTooltip as TooltipMetadata | undefined;
  delete option.__chartsdkValueFormat;
  delete option.__chartsdkTooltip;

  if (option.tooltip && metadata?.tooltip && metadata.tooltip !== 'raw') {
    option.tooltip.valueFormatter = (value: unknown) => formatChartValue(value, metadata.tooltip!, metadata.unit ?? '');
  }
  if (metadata) {
    const axes = Array.isArray(option.yAxis) ? option.yAxis : option.yAxis ? [option.yAxis] : [];
    for (const axis of axes) {
      axis.axisLabel = { ...(axis.axisLabel ?? {}) };
      axis.axisLabel.formatter = (value: unknown) => formatChartValue(value, metadata.yAxis ?? 'raw', metadata.unit ?? '');
    }
  }
  hydrateVerticalAxisLabels(option, metadata);

  if (option.tooltip && tooltipMetadata?.chartType && tooltipMetadata.mode === 'fields') {
    const valueFormatter = typeof option.tooltip.valueFormatter === 'function'
      ? option.tooltip.valueFormatter as (value: unknown) => string
      : (value: unknown) => String(value ?? '');
    option.tooltip.formatter = (params: TooltipParams | TooltipParams[]) => renderFieldTooltip(
      tooltipMetadata,
      params,
      valueFormatter,
      option,
    );
  } else if (option.tooltip && tooltipMetadata?.template && tooltipMetadata.chartType) {
    const valueFormatter = typeof option.tooltip.valueFormatter === 'function'
      ? option.tooltip.valueFormatter as (value: unknown) => string
      : (value: unknown) => String(value ?? '');
    option.tooltip.formatter = (params: TooltipParams | TooltipParams[]) => {
      const items = Array.isArray(params) ? params : [params];
      return items
        .map((item) => renderTooltip(
          tooltipMetadata.template!,
          tooltipMetadata.chartType!,
          item ?? {},
          valueFormatter,
          option,
        ))
        .join('<br/>');
    };
  }
  return option;
}

function renderFieldTooltip(
  metadata: TooltipMetadata,
  params: TooltipParams | TooltipParams[],
  valueFormatter: (value: unknown) => string,
  option: Record<string, any>,
): string {
  const items = (Array.isArray(params) ? params : [params]).filter(Boolean);
  const fields = Array.isArray(metadata.fields) ? metadata.fields : [];
  if (items.length === 0 || fields.length === 0) return '';

  const category = fields.find((item) => item.kind === 'category');
  const blocks: string[] = [];
  if (category && items.length > 1) {
    const categoryValue = fieldValue(category, items[0], metadata.chartType!, option);
    if (categoryValue != null) blocks.push(renderFieldLine(category.label, categoryValue, false, valueFormatter));
  }

  for (const item of items) {
    const lines: string[] = [];
    for (const descriptor of fields) {
      if (descriptor === category && items.length > 1) continue;
      if (!fieldAppliesToItem(descriptor, item, metadata.chartType!, option)) continue;
      const value = fieldValue(descriptor, item, metadata.chartType!, option);
      if (value == null || value === '') continue;
      lines.push(renderFieldLine(
        descriptor.label,
        value,
        isFormattedValue(descriptor.kind),
        valueFormatter,
        descriptor.kind === 'percent',
      ));
    }
    if (lines.length === 0) continue;
    const marker = metadata.showSeriesColor !== false && typeof item.marker === 'string'
      ? item.marker
      : '';
    blocks.push(`${marker}${lines.join('<br/>')}`);
  }
  return blocks.join('<br/>');
}

function fieldAppliesToItem(
  descriptor: TooltipFieldDescriptor,
  params: TooltipParams,
  chartType: MajorType,
  option: Record<string, any>,
): boolean {
  if (!descriptor.seriesName) return true;
  if (chartType === 'heatmap') {
    const values = Array.isArray(params.value) ? params.value : [];
    const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
    const current = Array.isArray(yAxis?.data)
      ? yAxis.data[Number(values[1])] ?? values[1]
      : values[1];
    return String(current ?? '') === descriptor.seriesName;
  }
  return String(params.seriesName ?? '') === descriptor.seriesName;
}

function fieldValue(
  descriptor: TooltipFieldDescriptor,
  params: TooltipParams,
  chartType: MajorType,
  option: Record<string, any>,
): unknown {
  const values = Array.isArray(params.value) ? params.value : [];
  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const boxValues = values.slice(-5);
  const outlier = chartType === 'boxplot'
    && typeof params.seriesId === 'string'
    && params.seriesId.startsWith('__chartsdk_boxplot_outliers');

  switch (descriptor.kind) {
    case 'category':
      if (chartType === 'heatmap' && Array.isArray(xAxis?.data)) {
        return xAxis.data[Number(values[0])] ?? values[0];
      }
      return params.axisValueLabel ?? params.name ?? values[0];
    case 'series':
      return params.seriesName;
    case 'measure':
      if (Array.isArray(params.value)) {
        if (chartType === 'heatmap') return values[2];
        if (descriptor.valueIndex != null && descriptor.valueIndex < values.length) {
          return values[descriptor.valueIndex];
        }
        return values.at(-1);
      }
      return params.value;
    case 'percent':
      if (params.percent != null) return params.percent;
      return typeof params.value === 'number' ? params.value * 100 : null;
    case 'x':
      return values[0];
    case 'y':
      return values[1] ?? params.value;
    case 'bubbleSize':
      return values[2];
    case 'boxMin':
      return outlier ? null : boxValues[0];
    case 'boxQ1':
      return outlier ? null : boxValues[1];
    case 'boxMedian':
      return outlier ? null : boxValues[2];
    case 'boxQ3':
      return outlier ? null : boxValues[3];
    case 'boxMax':
      return outlier ? null : boxValues[4];
    case 'boxOutlier':
      return outlier ? values[1] ?? values.at(-1) : null;
    case 'geoName':
      return params.name;
    case 'geoValue':
      return values[descriptor.valueIndex ?? 2] ?? params.value;
    case 'geoSize':
      return values[descriptor.valueIndex ?? 3];
    case 'geoColor':
      return values[descriptor.valueIndex ?? 4];
    case 'longitude':
      return values[descriptor.valueIndex ?? 0];
    case 'latitude':
      return values[descriptor.valueIndex ?? 1];
    default:
      return null;
  }
}

function isFormattedValue(kind: TooltipFieldDescriptor['kind']): boolean {
  return !['category', 'series', 'geoName', 'longitude', 'latitude', 'percent'].includes(kind);
}

function renderFieldLine(
  label: string,
  value: unknown,
  formatted: boolean,
  valueFormatter: (value: unknown) => string,
  percent = false,
): string {
  const rendered = percent
    ? `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(Number(value))}%`
    : formatted
      ? valueFormatter(value)
      : String(value ?? '');
  return `${escapeHtml(label)}: ${escapeHtml(rendered)}`;
}

/**
 * ECharts Canvas 축 라벨에는 CSS writing-mode을 적용할 수 없다.
 * 서버가 남긴 축 역할 메타데이터를 글자 단위 줄바꿈 formatter로 복원해,
 * 글자를 90° 돌리지 않고 위에서 아래로 읽는 실제 세로쓰기를 만든다.
 */
function hydrateVerticalAxisLabels(option: Record<string, any>, metadata?: FormatMetadata): void {
  const axes = [
    ...(Array.isArray(option.xAxis) ? option.xAxis : option.xAxis ? [option.xAxis] : []),
    ...(Array.isArray(option.yAxis) ? option.yAxis : option.yAxis ? [option.yAxis] : []),
  ];
  for (const axis of axes) {
    const role = axis?.__chartsdkVerticalLabel as VerticalAxisRole | undefined;
    delete axis?.__chartsdkVerticalLabel;
    if ((role !== 'x' && role !== 'y') || !axis) continue;

    axis.axisLabel = { ...(axis.axisLabel ?? {}) };
    // 세로쓰기는 formatter만 교체하고 기존 rotate는 보존한다. category 축과 논리 X축은 원문을,
    // 논리 Y 수치축은 기존 단위·숫자 포맷을 먼저 적용한 뒤 세로로 쌓는다.
    const format = role === 'y' && axis.type !== 'category' && metadata
      ? (value: unknown) => formatChartValue(value, metadata.yAxis ?? 'raw', metadata.unit ?? '')
      : (value: unknown) => String(value ?? '');
    axis.axisLabel.formatter = (value: unknown) => verticalizeAxisLabel(format(value));
  }
}

/** 결합문자·이모지 ZWJ 시퀀스를 쪼개지 않는 grapheme 단위 세로쓰기. */
export function verticalizeAxisLabel(value: unknown): string {
  const text = String(value ?? '');
  if (!text) return '';
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)].map((entry) => entry.segment)
    : Array.from(text);
  return segments.filter((segment) => segment !== '\r' && segment !== '\n').join('\n');
}

function renderTooltip(
  template: string,
  chartType: MajorType,
  params: TooltipParams,
  valueFormatter: (value: unknown) => string,
  option: Record<string, any>,
): string {
  const dimensions = Array.isArray(params.value) ? params.value : [];
  if (
    chartType === 'boxplot'
    && typeof params.seriesId === 'string'
    && params.seriesId.startsWith('__chartsdk_boxplot_outliers')
  ) {
    const outlierValue = dimensions[1] ?? dimensions.at(-1);
    return `${escapeHtml(String(params.name ?? dimensions[0] ?? ''))}<br/>이상치: ${
      escapeHtml(valueFormatter(outlierValue))
    }`;
  }
  const boxValues = dimensions.slice(-5);
  const rawValue = chartType === 'geoscatter'
    ? dimensions[2]
    : chartType === 'scatter'
      ? dimensions[1]
      : chartType === 'heatmap'
        ? dimensions[2]
        : params.value;
  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const yAxis = Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis;
  const x = chartType === 'heatmap' && Array.isArray(xAxis?.data)
    ? xAxis.data[Number(dimensions[0])] ?? dimensions[0]
    : dimensions[0];
  const y = chartType === 'heatmap' && Array.isArray(yAxis?.data)
    ? yAxis.data[Number(dimensions[1])] ?? dimensions[1]
    : dimensions[1];
  const values: Record<string, unknown> = {
    series: params.seriesName,
    name: params.name,
    value: rawValue == null ? '' : valueFormatter(rawValue),
    x,
    y,
    percent: params.percent,
    lng: dimensions[0],
    lat: dimensions[1],
    min: boxValues[0] == null ? '' : valueFormatter(boxValues[0]),
    q1: boxValues[1] == null ? '' : valueFormatter(boxValues[1]),
    median: boxValues[2] == null ? '' : valueFormatter(boxValues[2]),
    q3: boxValues[3] == null ? '' : valueFormatter(boxValues[3]),
    max: boxValues[4] == null ? '' : valueFormatter(boxValues[4]),
  };
  let rendered = escapeHtml(template).replace(/\r?\n/g, '<br/>');
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{${key}}`, escapeHtml(String(value ?? '')));
  }
  return rendered;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatChartValue(value: unknown, format: ValueFormat, unit = ''): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return `${String(value ?? '')}${unit}`;
  const formatted = format === 'percent'
    ? `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(number * 100)}%`
    : format === 'comma'
      ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 20 }).format(number)
      : format === 'decimal0'
        ? new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(number)
        : format === 'decimal1'
          ? new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(number)
          : String(value);
  return `${formatted}${unit}`;
}
