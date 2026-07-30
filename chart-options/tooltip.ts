import type { MajorType } from './optionRegistry';

export type TooltipFieldKind =
  | 'category'
  | 'series'
  | 'measure'
  | 'percent'
  | 'x'
  | 'y'
  | 'bubbleSize'
  | 'boxMin'
  | 'boxQ1'
  | 'boxMedian'
  | 'boxQ3'
  | 'boxMax'
  | 'boxOutlier'
  | 'geoName'
  | 'geoValue'
  | 'geoSize'
  | 'geoColor'
  | 'longitude'
  | 'latitude';

export interface TooltipFieldDescriptor {
  key: string;
  label: string;
  role: string;
  kind: TooltipFieldKind;
  defaultVisible: boolean;
  seriesName?: string;
  valueIndex?: number;
}

export interface TooltipFieldContext {
  chartType: MajorType;
  columns: readonly { name: string; type?: string }[];
  options?: Record<string, any>;
  builderConfig?: Record<string, any> | null;
}

export type TooltipFieldVisibility = Record<string, boolean>;

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

const INTERNAL_GEO_COLUMNS = {
  longitude: '__chartsdk_longitude',
  latitude: '__chartsdk_latitude',
  name: '__chartsdk_point_name',
  value: '__chartsdk_point_value',
  size: '__chartsdk_size',
  color: '__chartsdk_color_value',
  series: '__chartsdk_series',
  areaName: '__chartsdk_area_name',
  areaValue: '__chartsdk_area_value',
} as const;

function lastSegment(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const dot = text.lastIndexOf('.');
  return dot >= 0 ? text.slice(dot + 1) : text;
}

function humanize(value: unknown, fallback: string): string {
  const text = lastSegment(value, fallback)
    .replace(/^__chartsdk_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return text || fallback;
}

function measureLabel(field: Record<string, any> | undefined, fallback: string): string {
  if (!field) return humanize(fallback, '값');
  const alias = String(field.alias ?? '').trim();
  if (alias) return alias;
  const base = humanize(field.column, fallback);
  const aggregate = String(field.agg ?? 'none');
  return aggregate === 'none' ? base : `${base} ${AGGREGATE_LABELS[aggregate] ?? aggregate}`;
}

function measureKey(field: Record<string, any> | undefined, index: number, fallback: string): string {
  if (!field) return `measure:${fallback}:${index}`;
  return `measure:${String(field.agg ?? 'none')}:${String(field.column ?? fallback)}:${index}`;
}

function field(
  key: string,
  label: string,
  role: string,
  kind: TooltipFieldKind,
  extras: Partial<TooltipFieldDescriptor> = {},
): TooltipFieldDescriptor {
  return {
    key,
    label,
    role,
    kind,
    defaultVisible: extras.defaultVisible ?? true,
    ...(extras.seriesName != null ? { seriesName: extras.seriesName } : {}),
    ...(extras.valueIndex != null ? { valueIndex: extras.valueIndex } : {}),
  };
}

function resultColumn(context: TooltipFieldContext, index: number, fallback: string): string {
  return context.columns[index]?.name || fallback;
}

function cartesianFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const seriesBy = String(builder.seriesBy ?? '').trim();
  const fields: TooltipFieldDescriptor[] = [];
  const xIdentity = String(builder.xAxis ?? resultColumn(context, 0, 'x'));
  fields.push(field(`x:${xIdentity}`, humanize(builder.xAxis ?? resultColumn(context, 0, '카테고리'), '카테고리'), '가로축', 'category'));

  if (seriesBy) {
    fields.push(field(`series:${seriesBy}`, humanize(seriesBy, '계열'), '계열', 'series'));
    const source = yAxis[0];
    fields.push(field(
      measureKey(source, 0, resultColumn(context, 2, '값')),
      measureLabel(source, resultColumn(context, 2, '값')),
      AGGREGATE_LABELS[String(source?.agg ?? 'none')] ?? '값',
      'measure',
      { valueIndex: 1 },
    ));
    return fields;
  }

  context.columns.slice(1).forEach((column, index) => {
    const source = yAxis[index];
    fields.push(field(
      measureKey(source, index, column.name),
      measureLabel(source, column.name),
      AGGREGATE_LABELS[String(source?.agg ?? 'none')] ?? '값',
      'measure',
      { seriesName: column.name, valueIndex: index + 1 },
    ));
  });

  if (context.chartType === 'bar' && context.options?.bar?.normalize === true) {
    fields.push(field('derived:percent', '구성비', '계산값', 'percent'));
  }
  return fields;
}

function scatterFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const bubbleName = context.options?.variant === 'bubble'
    ? String(context.options?.scatter?.bubbleField ?? '')
    : '';
  const xName = resultColumn(context, 0, 'X');
  const fields: TooltipFieldDescriptor[] = [
    field(`x:${String(builder.xAxis ?? xName)}`, humanize(builder.xAxis ?? xName, 'X'), '가로축', 'x', { valueIndex: 0 }),
  ];

  context.columns.slice(1).forEach((column, index) => {
    const source = yAxis[index];
    if (bubbleName && column.name === bubbleName) {
      fields.push(field(
        `bubble:${String(source?.column ?? column.name)}`,
        measureLabel(source, column.name),
        '버블 크기',
        'bubbleSize',
        { valueIndex: 2 },
      ));
      return;
    }
    fields.push(field(
      measureKey(source, index, column.name),
      measureLabel(source, column.name),
      '세로축',
      'y',
      { seriesName: column.name, valueIndex: 1 },
    ));
  });
  return fields;
}

function pieFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const categoryName = resultColumn(context, 0, '항목');
  const valueName = resultColumn(context, 1, '값');
  return [
    field(`category:${String(builder.xAxis ?? categoryName)}`, humanize(builder.xAxis ?? categoryName, '항목'), '항목', 'category'),
    field(measureKey(yAxis[0], 0, valueName), measureLabel(yAxis[0], valueName), AGGREGATE_LABELS[String(yAxis[0]?.agg ?? 'none')] ?? '값', 'measure'),
    field('derived:percent', '구성비', '계산값', 'percent'),
  ];
}

function boxplotFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const categoryName = resultColumn(context, 0, '카테고리');
  const valueName = measureLabel(yAxis[0], resultColumn(context, 1, '값'));
  const identity = String(yAxis[0]?.column ?? resultColumn(context, 1, 'value'));
  return [
    field(`category:${String(builder.xAxis ?? categoryName)}`, humanize(builder.xAxis ?? categoryName, '카테고리'), '카테고리', 'category'),
    field(`box:min:${identity}`, `${valueName} 최솟값`, '계산값', 'boxMin', { valueIndex: 0 }),
    field(`box:q1:${identity}`, `${valueName} 1사분위수`, '계산값', 'boxQ1', { valueIndex: 1 }),
    field(`box:median:${identity}`, `${valueName} 중앙값`, '계산값', 'boxMedian', { valueIndex: 2 }),
    field(`box:q3:${identity}`, `${valueName} 3사분위수`, '계산값', 'boxQ3', { valueIndex: 3 }),
    field(`box:max:${identity}`, `${valueName} 최댓값`, '계산값', 'boxMax', { valueIndex: 4 }),
    field(`box:outlier:${identity}`, `${valueName} 이상치`, '계산값', 'boxOutlier'),
  ];
}

function heatmapFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const xName = resultColumn(context, 0, '가로 항목');
  const fields = [
    field(`x:${String(builder.xAxis ?? xName)}`, humanize(builder.xAxis ?? xName, '가로 항목'), '가로축', 'category'),
  ];
  context.columns.slice(1).forEach((column, index) => {
    const source = yAxis[index];
    fields.push(field(
      measureKey(source, index, column.name),
      measureLabel(source, column.name),
      '측정 항목',
      'measure',
      { seriesName: column.name, valueIndex: 2 },
    ));
  });
  return fields;
}

function areaMapFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const area = builder.geoArea && typeof builder.geoArea === 'object' ? builder.geoArea : {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const nameRef = area.nameColumn ?? builder.xAxis ?? resultColumn(context, 0, '지역');
  const valueRef = area.valueColumn ?? yAxis[0]?.column ?? resultColumn(context, 1, '값');
  const valueSource = area.valueColumn ? { column: area.valueColumn, agg: 'none' } : yAxis[0];
  const fields = [
    field(`region:${String(nameRef)}`, humanize(nameRef, '지역'), '지역', 'category'),
  ];
  if (builder.seriesBy) {
    fields.push(field(`series:${String(builder.seriesBy)}`, humanize(builder.seriesBy, '계열'), '계열', 'series'));
  }
  if (valueRef) {
    fields.push(field(
      measureKey(valueSource, 0, String(valueRef)),
      measureLabel(valueSource, String(valueRef)),
      AGGREGATE_LABELS[String(valueSource?.agg ?? 'none')] ?? '값',
      'geoValue',
    ));
  }
  return fields;
}

function geoPointFields(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  const builder = context.builderConfig ?? {};
  const point = builder.geoPoint && typeof builder.geoPoint === 'object' ? builder.geoPoint : {};
  const yAxis = Array.isArray(builder.yAxis) ? builder.yAxis as Record<string, any>[] : [];
  const fields: TooltipFieldDescriptor[] = [];
  const hasColumn = (name: string) => context.columns.some((column) => column.name === name);
  const nameRef = point.nameColumn;
  const valueRef = point.valueColumn;
  const sizeRef = point.sizeColumn ?? (context.chartType === 'geoscatter' ? yAxis[1]?.column : null);
  const colorRef = point.colorColumn;

  if (nameRef || hasColumn(INTERNAL_GEO_COLUMNS.name)) {
    fields.push(field(`geo:name:${String(nameRef ?? INTERNAL_GEO_COLUMNS.name)}`, humanize(nameRef, '포인트 이름'), '포인트 이름', 'geoName'));
  }
  if (builder.seriesBy || hasColumn(INTERNAL_GEO_COLUMNS.series)) {
    fields.push(field(`series:${String(builder.seriesBy ?? INTERNAL_GEO_COLUMNS.series)}`, humanize(builder.seriesBy, '계열'), '계열', 'series'));
  }
  if (valueRef || hasColumn(INTERNAL_GEO_COLUMNS.value)) {
    fields.push(field(`geo:value:${String(valueRef ?? INTERNAL_GEO_COLUMNS.value)}`, humanize(valueRef, '값'), context.chartType === 'map' ? '강도 값' : '값', 'geoValue', { valueIndex: 2 }));
  }
  if (context.chartType === 'geoscatter' && (sizeRef || hasColumn(INTERNAL_GEO_COLUMNS.size))) {
    fields.push(field(`geo:size:${String(sizeRef ?? INTERNAL_GEO_COLUMNS.size)}`, humanize(sizeRef, '크기'), '포인트 크기', 'geoSize', { valueIndex: 3 }));
  }
  if (colorRef || hasColumn(INTERNAL_GEO_COLUMNS.color)) {
    fields.push(field(`geo:color:${String(colorRef ?? INTERNAL_GEO_COLUMNS.color)}`, humanize(colorRef, '색상 값'), '색상 기준', 'geoColor', {
      valueIndex: context.chartType === 'map' ? 3 : 4,
    }));
  }

  const longitudeRef = point.mode === 'spatial' ? '경도' : builder.xAxis ?? INTERNAL_GEO_COLUMNS.longitude;
  const latitudeRef = point.mode === 'spatial' ? '위도' : yAxis[0]?.column ?? INTERNAL_GEO_COLUMNS.latitude;
  fields.push(
    field(`geo:longitude:${String(longitudeRef)}`, humanize(longitudeRef, '경도'), point.mode === 'spatial' ? '위치 계산값' : '위치', 'longitude', {
      defaultVisible: false,
      valueIndex: 0,
    }),
    field(`geo:latitude:${String(latitudeRef)}`, humanize(latitudeRef, '위도'), point.mode === 'spatial' ? '위치 계산값' : '위치', 'latitude', {
      defaultVisible: false,
      valueIndex: 1,
    }),
  );
  return fields;
}

export function tooltipFieldsFor(context: TooltipFieldContext): TooltipFieldDescriptor[] {
  // 실행 전 빌더 설정만으로 항목을 추측하지 않는다. 툴팁 카탈로그는 실제 차트 조회 결과에
  // 포함된 컬럼을 기준으로 만들며, builderConfig는 그 컬럼의 원본 이름·별칭을 복원하는 데만 쓴다.
  if (context.columns.length === 0) return [];
  switch (context.chartType) {
    case 'bar':
    case 'line':
      return cartesianFields(context);
    case 'pie':
      return pieFields(context);
    case 'scatter':
      return scatterFields(context);
    case 'boxplot':
      return boxplotFields(context);
    case 'heatmap':
      return heatmapFields(context);
    case 'map':
      return context.options?.variant === 'heatmap'
        ? geoPointFields(context)
        : areaMapFields(context);
    case 'geoscatter':
      return geoPointFields(context);
    default:
      return [];
  }
}

export function normalizeTooltipFieldVisibility(value: unknown): TooltipFieldVisibility {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}

export function tooltipFieldVisible(
  descriptor: TooltipFieldDescriptor,
  visibility: unknown,
): boolean {
  const normalized = normalizeTooltipFieldVisibility(visibility);
  return normalized[descriptor.key] ?? descriptor.defaultVisible;
}

export function updateTooltipFieldVisibility(
  current: unknown,
  descriptor: TooltipFieldDescriptor,
  visible: boolean,
): TooltipFieldVisibility {
  const next = normalizeTooltipFieldVisibility(current);
  if (visible === descriptor.defaultVisible) delete next[descriptor.key];
  else next[descriptor.key] = visible;
  return next;
}

export function visibleTooltipFields(
  descriptors: readonly TooltipFieldDescriptor[],
  visibility: unknown,
): TooltipFieldDescriptor[] {
  return descriptors.filter((descriptor) => tooltipFieldVisible(descriptor, visibility));
}
