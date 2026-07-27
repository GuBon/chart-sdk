import type { MajorType } from './optionRegistry';

export type ValueFormat = 'raw' | 'comma' | 'decimal0' | 'decimal1' | 'percent';

type FormatMetadata = { tooltip?: ValueFormat; yAxis?: ValueFormat; unit?: string };
type TooltipMetadata = {
  chartType?: MajorType;
  template?: string;
};

type TooltipParams = {
  seriesName?: unknown;
  name?: unknown;
  value?: unknown;
  percent?: unknown;
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

  if (option.tooltip && tooltipMetadata?.template && tooltipMetadata.chartType) {
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

function renderTooltip(
  template: string,
  chartType: MajorType,
  params: TooltipParams,
  valueFormatter: (value: unknown) => string,
  option: Record<string, any>,
): string {
  const dimensions = Array.isArray(params.value) ? params.value : [];
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
