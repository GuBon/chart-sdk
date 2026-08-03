export const SERIES_DISPLAY_NAMES_KEY = '__chartsdkSeriesDisplayNames';
export const AXIS_DISPLAY_NAMES_KEY = '__chartsdkAxisDisplayNames';

const AGGREGATE_LABELS: Record<string, string> = {
  sum: '합계',
  avg: '평균',
  stddev: '표준편차',
  variance: '분산',
  count: '개수',
  count_distinct: '고유 개수',
  min: '최솟값',
  max: '최댓값',
  none: '값',
};

export function lastFieldSegment(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const dot = text.lastIndexOf('.');
  return dot >= 0 ? text.slice(dot + 1) : text;
}

export function fieldDisplayName(
  builderConfig: Record<string, any> | null | undefined,
  fieldRef: unknown,
  fallback = '',
): string {
  const reference = String(fieldRef ?? '').trim();
  const snapshots = builderConfig?.fieldDisplayNames;
  if (reference && snapshots && typeof snapshots === 'object' && !Array.isArray(snapshots)) {
    const snapshot = String(snapshots[reference] ?? '').trim();
    if (snapshot) return snapshot;
  }
  return humanizeField(reference || fallback, fallback);
}

export function measureDisplayName(
  builderConfig: Record<string, any> | null | undefined,
  field: Record<string, any> | null | undefined,
  fallback: string,
): string {
  const alias = String(field?.alias ?? '').trim();
  if (alias) return alias;
  const base = fieldDisplayName(builderConfig, field?.column, fallback);
  const aggregate = String(field?.agg ?? 'none');
  return aggregate === 'none' ? base : `${base} ${AGGREGATE_LABELS[aggregate] ?? aggregate}`;
}

export function seriesDisplayNames(
  builderConfig: Record<string, any> | null | undefined,
  resultColumns: readonly { name: string }[],
): Record<string, string> {
  if (!builderConfig || String(builderConfig.seriesBy ?? '').trim()) return {};
  const measures = Array.isArray(builderConfig.yAxis) ? builderConfig.yAxis : [];
  const names: Record<string, string> = {};
  resultColumns.slice(1).forEach((column, index) => {
    const fieldRef = String(measures[index]?.column ?? '').trim();
    const snapshot = fieldRef && builderConfig.fieldDisplayNames
      && typeof builderConfig.fieldDisplayNames === 'object'
      && !Array.isArray(builderConfig.fieldDisplayNames)
      ? String(builderConfig.fieldDisplayNames[fieldRef] ?? '').trim()
      : '';
    if (!snapshot) return;
    const displayName = measureDisplayName(builderConfig, measures[index], column.name);
    if (displayName && displayName !== column.name) names[column.name] = displayName;
  });
  return names;
}

export function humanizeField(value: unknown, fallback: string): string {
  const text = lastFieldSegment(value, fallback)
    .replace(/^__chartsdk_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return text || fallback;
}

export function aggregateLabel(aggregate: unknown): string {
  const key = String(aggregate ?? 'none');
  return AGGREGATE_LABELS[key] ?? key;
}
