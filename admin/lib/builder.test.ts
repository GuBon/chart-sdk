import { describe, expect, it } from 'vitest';
import type { BuilderConfig, SchemaTable, TableRef } from '@/lib/api';
import {
  activeTables,
  aggChoicesForChart,
  builderValidationIssue,
  builderWarning,
  columnType,
  columnsForBuilder,
  createSampleConfig,
  emptyBuilder,
  emptyJoin,
  hasJoins,
  isDateType,
  isNumericType,
  isSpatialAreaType,
  isSpatialPointType,
  migrateBuilderConfig,
  migrateTableRef,
  normalizeBuilder,
  normalizeBuilderForChartType,
  normalizeSampleConfig,
  orderTargets,
  parseColumn,
  tableHandle,
  tableRefKey,
  tableRefLabel,
  withUniqueHandle,
} from './builder';

// ── 테스트 픽스처 (동명 크로스소스 테이블 포함) ──
const SALES: SchemaTable = {
  datasourceId: 1, schema: 'public', name: 'sales', relationType: 'TABLE',
  columns: [
    { name: 'id', type: 'int' },
    { name: 'category', type: 'text' },
    { name: 'amount', type: 'numeric' },
    { name: 'date', type: 'date' },
    { name: 'customer_id', type: 'int' },
    { name: 'location', type: 'geometry(Point,4326)' },
    { name: 'location_geog', type: 'geography(Point,4326)' },
    { name: 'service_area', type: 'geometry(Polygon,4326)' },
    { name: 'service_area_geog', type: 'geography(MultiPolygon,4326)' },
  ],
};
const USERS1: SchemaTable = {
  datasourceId: 1, schema: 'public', name: 'users', relationType: 'TABLE',
  columns: [{ name: 'id', type: 'int' }, { name: 'name', type: 'text' }],
};
const USERS2: SchemaTable = {
  datasourceId: 2, schema: 'public', name: 'users', relationType: 'TABLE',
  columns: [{ name: 'id', type: 'int' }, { name: 'tier', type: 'text' }],
};
const EVENTS: SchemaTable = {
  datasourceId: 1, schema: 'analytics', name: 'events', relationType: 'TABLE',
  columns: [{ name: 'id', type: 'int' }, { name: 'value', type: 'numeric' }],
};
const TABLES: SchemaTable[] = [SALES, USERS1, USERS2, EVENTS];

const salesRef: TableRef = { datasourceId: 1, schema: 'public', name: 'sales' };
const users1Ref: TableRef = { datasourceId: 1, schema: 'public', name: 'users' };
const users2Ref: TableRef = { datasourceId: 2, schema: 'public', name: 'users' };

const bar = (over?: Partial<BuilderConfig>): BuilderConfig => ({
  table: salesRef, joins: [], xAxis: 'category', xAxisBucket: null,
  yAxis: [{ column: 'amount', agg: 'sum' }], where: [], orderBy: null, sample: null, ...over,
});

// base=users(ds1) ⋈ users(ds2, 핸들 users_2) — 동명 크로스소스 조인. 컬럼은 핸들로 qualified.
const crossJoin = (): BuilderConfig => ({
  table: users1Ref,
  joins: [{ table: { ...users2Ref, handle: 'users_2' }, type: 'inner', on: { leftColumn: 'users.id', rightColumn: 'users_2.id' } }],
  xAxis: 'users.name', xAxisBucket: null,
  yAxis: [{ column: 'users_2.tier', agg: 'count' }], where: [], orderBy: null, sample: null,
});

describe('타입 판정', () => {
  it('isDateType 은 date/timestamp/time 계열을 인식한다', () => {
    expect(isDateType('date')).toBe(true);
    expect(isDateType('timestamptz')).toBe(true);
    expect(isDateType('time')).toBe(true);
    expect(isDateType('text')).toBe(false);
    expect(isDateType(undefined)).toBe(false);
  });

  it('공간 영역 타입은 SRID가 있는 Polygon과 MultiPolygon만 인식한다', () => {
    expect(isSpatialAreaType('geometry(Polygon,4326)')).toBe(true);
    expect(isSpatialAreaType('geography(MultiPolygon, 4326)')).toBe(true);
    expect(isSpatialAreaType('geometry(Point,4326)')).toBe(false);
    expect(isSpatialAreaType('geometry')).toBe(false);
  });
  it('isNumericType 은 정수·실수 계열을 인식한다', () => {
    expect(isNumericType('int')).toBe(true);
    expect(isNumericType('bigint')).toBe(true);
    expect(isNumericType('numeric')).toBe(true);
    expect(isNumericType('double precision')).toBe(true);
    expect(isNumericType('text')).toBe(false);
    expect(isNumericType('date')).toBe(false);
  });
  it('isSpatialPointType 은 SRID가 지정된 PostGIS Point만 인식한다', () => {
    expect(isSpatialPointType('geometry(Point,4326)')).toBe(true);
    expect(isSpatialPointType('geography(PointZ, 4326)')).toBe(true);
    expect(isSpatialPointType('geometry(Polygon,4326)')).toBe(false);
    expect(isSpatialPointType('geometry')).toBe(false);
  });
});

describe('aggChoicesForChart', () => {
  it('분포(scatter)는 원본값(none)만 허용한다', () => {
    const choices = aggChoicesForChart('scatter');
    expect(choices).toHaveLength(1);
    expect(choices[0].value).toBe('none');
  });
  it('막대는 분산을 포함한 집계 9종을 모두 제공한다', () => {
    expect(aggChoicesForChart('bar')).toHaveLength(9);
    expect(aggChoicesForChart('bar').map((choice) => choice.value)).toContain('variance');
  });
});

describe('표본 설정', () => {
  it('자동 모드는 방식·크기를 서버에 위임한다(rate 없이 seed만, 테이블 독립)', () => {
    const sample = createSampleConfig();
    expect(sample.mode).toBe('auto');
    expect((sample as { rate?: number }).rate).toBeUndefined();
    expect(Number.isInteger(sample.seed)).toBe(true);
  });

  it('수동 모드는 표본 크기(갯수)를 1,000~50,000 으로 정규화한다', () => {
    expect(normalizeSampleConfig({ mode: 'manual', size: 999_999 })).toEqual({ mode: 'manual', size: 50_000, seed: 48_291 });
    expect(normalizeSampleConfig({ mode: 'manual', size: 100 })).toEqual({ mode: 'manual', size: 1_000, seed: 48_291 });
  });

  it('레거시 rate 전용 설정은 수동 모드와 기본 seed로 정규화한다', () => {
    expect(normalizeSampleConfig({ rate: 10 })).toEqual({ mode: 'manual', rate: 10, seed: 48_291 });
  });
});

describe('테이블 식별자', () => {
  it('tableRefKey 는 소스.스키마.이름 안정 키를 만든다', () => {
    expect(tableRefKey(salesRef)).toBe('1.public.sales');
    expect(tableRefKey(users2Ref)).toBe('2.public.users');
  });
  it('tableRefLabel 은 public 을 포함한 스키마를 항상 표시한다', () => {
    expect(tableRefLabel(salesRef)).toBe('public.sales');
    expect(tableRefLabel({ datasourceId: 1, schema: 'analytics', name: 'events' })).toBe('analytics.events');
  });
  it('tableHandle 은 handle 우선, 없으면 name', () => {
    expect(tableHandle(salesRef)).toBe('sales');
    expect(tableHandle({ ...users2Ref, handle: 'users_2' })).toBe('users_2');
  });
});

describe('withUniqueHandle — 동명 충돌 시 접미', () => {
  it('충돌이 없으면 handle 을 부여하지 않는다(기존 차트 불변)', () => {
    expect(withUniqueHandle(salesRef, [users1Ref]).handle).toBeUndefined();
  });
  it('동명 테이블과 겹치면 _2 를 부여한다', () => {
    expect(withUniqueHandle(users2Ref, [users1Ref]).handle).toBe('users_2');
  });
  it('_2 까지 점유되면 _3 로 증가한다', () => {
    const others: TableRef[] = [users1Ref, { ...users2Ref, handle: 'users_2' }];
    expect(withUniqueHandle({ datasourceId: 3, schema: 'public', name: 'users' }, others).handle).toBe('users_3');
  });
});

describe('activeTables', () => {
  it('base + 조인 테이블을 등장 순서로 모은다', () => {
    const keys = activeTables(crossJoin()).map(tableRefKey);
    expect(keys).toEqual(['1.public.users', '2.public.users']);
  });
  it('table 이 없으면 빈 배열', () => {
    expect(activeTables(emptyBuilder())).toEqual([]);
  });
});

describe('parseColumn', () => {
  it('"핸들.컬럼" 을 분해한다', () => {
    expect(parseColumn('users_2.tier', 'users')).toEqual({ table: 'users_2', column: 'tier' });
  });
  it("'.' 없으면 base 테이블 이름을 암묵 부여한다", () => {
    expect(parseColumn('amount', 'sales')).toEqual({ table: 'sales', column: 'amount' });
    expect(parseColumn('amount', null)).toEqual({ table: null, column: 'amount' });
  });
});

describe('columnsForBuilder', () => {
  it('미조인 시 base 컬럼을 bare 로 제공한다', () => {
    const opts = columnsForBuilder(bar(), TABLES);
    expect(opts.map((o) => o.value)).toEqual([
      'id',
      'category',
      'amount',
      'date',
      'customer_id',
      'location',
      'location_geog',
      'service_area',
      'service_area_geog',
    ]);
    expect(opts.find((o) => o.value === 'amount')?.type).toBe('numeric');
  });
  it('조인 시 활성 테이블 전부를 "핸들.컬럼" 으로 qualified 한다', () => {
    const values = columnsForBuilder(crossJoin(), TABLES).map((o) => o.value);
    expect(values).toContain('users.name');
    expect(values).toContain('users_2.tier');
    expect(values).not.toContain('name'); // bare 는 조인 모드에서 나오지 않는다
  });
});

describe('columnType', () => {
  it('미조인 컬럼 타입을 해석한다', () => {
    expect(columnType('amount', bar(), TABLES)).toBe('numeric');
    expect(columnType('date', bar(), TABLES)).toBe('date');
  });
  it('조인 시 핸들로 타입을 해석한다(동명 테이블 구분)', () => {
    expect(columnType('users_2.tier', crossJoin(), TABLES)).toBe('text');
    expect(columnType('users.id', crossJoin(), TABLES)).toBe('int');
  });
});

describe('normalizeBuilderForChartType', () => {
  it('분포 전환은 집계를 none 으로·버킷과 표본을 해제한다', () => {
    const src = bar({ xAxisBucket: 'month', sample: { rate: 10 }, yAxis: [{ column: 'amount', agg: 'sum' }] });
    const out = normalizeBuilderForChartType(src, 'scatter');
    expect(out.xAxisBucket).toBeNull();
    expect(out.sample).toBeNull();
    expect(out.yAxis.every((y) => y.agg === 'none')).toBe(true);
  });
  it('원형 전환은 시리즈를 1개로 자른다', () => {
    const src = bar({ yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'count' }] });
    expect(normalizeBuilderForChartType(src, 'pie').yAxis).toHaveLength(1);
  });
  it('원본값 시리즈가 있으면 표본을 해제한다', () => {
    const src = bar({ yAxis: [{ column: 'amount', agg: 'none' }], sample: { rate: 20 } });
    expect(normalizeBuilderForChartType(src, 'line').sample).toBeNull();
  });
});

describe('builderValidationIssue', () => {
  it('정상 막대 구성은 null(오류 없음)', () => {
    expect(builderValidationIssue(bar(), 'bar', TABLES)).toBeNull();
  });
  it('테이블 미선택을 잡는다', () => {
    expect(builderValidationIssue(emptyBuilder(), 'bar', TABLES)).toBe('테이블을 선택하세요.');
  });
  it('표본 비율 범위를 잡는다', () => {
    const message = '표본 비율은 0.1~100%이며 소수점 한 자리까지 입력할 수 있습니다.';
    expect(builderValidationIssue(bar({ sample: { rate: 0 } }), 'bar', TABLES)).toBe(message);
    expect(builderValidationIssue(bar({ sample: { rate: 150 } }), 'bar', TABLES)).toBe(message);
    expect(builderValidationIssue(bar({ sample: { rate: 0.15 } }), 'bar', TABLES)).toBe(message);
    expect(builderValidationIssue(bar({ sample: { rate: 0.1 } }), 'bar', TABLES)).toBeNull();
  });
  it('X축 미선택을 잡는다', () => {
    expect(builderValidationIssue(bar({ xAxis: null }), 'bar', TABLES)).toBe('X축 컬럼을 선택하세요.');
  });
  it('Y축 미추가를 잡는다', () => {
    expect(builderValidationIssue(bar({ yAxis: [] }), 'bar', TABLES)).toBe('Y축을 1개 이상 추가하세요.');
  });
  it('원형은 Y축 2개를 거부한다', () => {
    const cfg = bar({ yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'count' }] });
    expect(builderValidationIssue(cfg, 'pie', TABLES)).toBe('원형 차트는 Y축을 1개만 사용할 수 있습니다.');
  });
  it('분포는 숫자 X축을 요구한다', () => {
    const cfg = bar({ xAxis: 'category', yAxis: [{ column: 'amount', agg: 'none' }] });
    expect(builderValidationIssue(cfg, 'scatter', TABLES)).toBe('분포 차트는 숫자 X축 컬럼이 필요합니다.');
  });
  it('분포는 집계 사용을 거부한다', () => {
    const cfg = bar({ xAxis: 'amount', yAxis: [{ column: 'id', agg: 'sum' }] });
    expect(builderValidationIssue(cfg, 'scatter', TABLES)).toBe('분포 차트는 집계 없이 원본값만 사용할 수 있습니다.');
  });
  it('원본값과 집계값 혼용을 거부한다', () => {
    const cfg = bar({ yAxis: [{ column: 'amount', agg: 'none' }, { column: 'id', agg: 'sum' }] });
    expect(builderValidationIssue(cfg, 'bar', TABLES)).toBe('원본값은 집계값과 섞을 수 없습니다. 모든 Y축을 원본값으로 선택하세요.');
  });
  it('조인 시 non-qualified 컬럼을 거부한다', () => {
    const cfg = crossJoin();
    cfg.xAxis = 'name'; // '.' 없음
    expect(builderValidationIssue(cfg, 'bar', TABLES)).toBe('조인 시 컬럼은 "테이블.컬럼" 형식이어야 합니다.');
  });
  it('동명 크로스소스 조인은 핸들로 구분되어 정상 검증된다', () => {
    expect(builderValidationIssue(crossJoin(), 'bar', TABLES)).toBeNull();
  });
  it('조인 결과 표본 추출을 허용한다', () => {
    const cfg = crossJoin();
    cfg.sample = { rate: 10 };
    expect(builderValidationIssue(cfg, 'bar', TABLES)).toBeNull();
  });
});

describe('builderWarning', () => {
  it('단일 소스·무조인은 경고 없음', () => {
    expect(builderWarning(bar())).toBeNull();
  });
  it('여러 데이터소스 조인은 스냅샷 안내를 낸다', () => {
    expect(builderWarning(crossJoin())).toContain('스냅샷');
  });
  it('조인 상한 초과를 경고한다', () => {
    const joins = Array.from({ length: 6 }, (_, i) => emptyJoin({ datasourceId: 1, schema: 'public', name: `t${i}` }));
    expect(builderWarning(bar({ joins }))).toContain('5개');
  });
});

describe('레거시 마이그레이션', () => {
  it('migrateTableRef 는 문자열을 TableRef 로 승격한다', () => {
    expect(migrateTableRef('sales', 1)).toEqual({ datasourceId: 1, schema: 'public', name: 'sales' });
    expect(migrateTableRef('analytics.events', 1)).toEqual({ datasourceId: 1, schema: 'analytics', name: 'events' });
    expect(migrateTableRef(null, 1)).toBeNull();
  });
  it('이미 구조화된 참조는 그대로 둔다', () => {
    expect(migrateTableRef(salesRef, 9)).toEqual(salesRef);
  });
  it('migrateBuilderConfig 는 동명 조인에 유일 핸들을 부여한다', () => {
    const legacy = { table: 'users', joins: [{ table: 'users', type: 'inner', on: { leftColumn: '', rightColumn: '' } }], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: null } as unknown as BuilderConfig;
    const out = migrateBuilderConfig(legacy, 1);
    expect(out.table).toEqual({ datasourceId: 1, schema: 'public', name: 'users' });
    expect(out.joins?.[0].table.handle).toBe('users_2');
  });
  it('저장된 handle 은 재부여하지 않고 보존한다', () => {
    const cfg = { table: users1Ref, joins: [{ table: { ...users2Ref, handle: 'keep_me' }, type: 'inner', on: { leftColumn: '', rightColumn: '' } }], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: null } as BuilderConfig;
    expect(migrateBuilderConfig(cfg, 1).joins?.[0].table.handle).toBe('keep_me');
  });
});

describe('orderTargets · 기타', () => {
  it('orderTargets 는 X축과 시리즈 별칭을 대상화한다', () => {
    const targets = orderTargets(bar());
    expect(targets[0]).toEqual({ value: 'x', label: 'category (X)' });
    expect(targets[1]).toEqual({ value: 'y0', label: 'sum_amount (Y1)' });
  });
  it('hasJoins · emptyJoin · normalizeBuilder 기본형', () => {
    expect(hasJoins(bar())).toBe(false);
    expect(hasJoins(crossJoin())).toBe(true);
    expect(emptyJoin(salesRef)).toEqual({ table: salesRef, type: 'left', on: { leftColumn: '', rightColumn: '' } });
    const normalized = normalizeBuilder({ table: salesRef, xAxis: 'category', xAxisBucket: null, yAxis: [], where: [], orderBy: null } as BuilderConfig);
    expect(normalized.joins).toEqual([]);
    expect(normalized.sample).toBeNull();
  });
});

describe('신규 유형 — boxplot · heatmap · map', () => {
  it('boxplot 은 원본값(none)만 허용한다', () => {
    const choices = aggChoicesForChart('boxplot');
    expect(choices).toHaveLength(1);
    expect(choices[0].value).toBe('none');
  });

  it('normalize(boxplot) 은 집계 none·표본/버킷 null·값 컬럼 1개로 정규화한다', () => {
    const src = bar({ xAxisBucket: 'month', sample: { rate: 20 }, yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'avg' }] });
    const out = normalizeBuilderForChartType(src, 'boxplot');
    expect(out.xAxisBucket).toBeNull();
    expect(out.sample).toBeNull();
    expect(out.yAxis).toHaveLength(1);
    expect(out.yAxis[0].agg).toBe('none');
  });

  it('normalize(map) 은 값 컬럼을 1개로 자른다', () => {
    const src = bar({ yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'count' }] });
    expect(normalizeBuilderForChartType(src, 'map').yAxis).toHaveLength(1);
  });

  it('boxplot 검증 — 값 컬럼은 숫자·1개·집계 없음', () => {
    // 정상: 숫자 amount 1개, none
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'amount', agg: 'none' }] }), 'boxplot', TABLES)).toBeNull();
    // 2개 → 거부
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'amount', agg: 'none' }, { column: 'id', agg: 'none' }] }), 'boxplot', TABLES))
      .toBe('박스 플롯은 값 컬럼(Y축)을 1개만 사용할 수 있습니다.');
    // 집계 있음 → 거부
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'amount', agg: 'sum' }] }), 'boxplot', TABLES))
      .toBe('박스 플롯은 집계 없이 원본값만 사용합니다.');
    // 비숫자 값 컬럼(category) → 거부
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'category', agg: 'none' }] }), 'boxplot', TABLES))
      .toBe('박스 플롯은 숫자 값 컬럼(Y축)이 필요합니다.');
  });

  it('map 검증 — 값 컬럼 1개', () => {
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'amount', agg: 'sum' }] }), 'map', TABLES)).toBeNull();
    expect(builderValidationIssue(bar({ yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'count' }] }), 'map', TABLES))
      .toBe('지도 차트는 값 컬럼(Y축)을 1개만 사용할 수 있습니다.');
  });

  it('geoscatter 는 원본값(none)만 허용하고 normalize 가 좌표 2컬럼으로 정규화한다', () => {
    expect(aggChoicesForChart('geoscatter')).toHaveLength(1);
    const src = bar({ xAxisBucket: 'month', sample: { rate: 20 }, yAxis: [{ column: 'amount', agg: 'sum' }, { column: 'id', agg: 'avg' }, { column: 'customer_id', agg: 'count' }] });
    const out = normalizeBuilderForChartType(src, 'geoscatter');
    expect(out.xAxisBucket).toBeNull();
    expect(out.sample).toBeNull();
    expect(out.yAxis).toHaveLength(2);
    expect(out.yAxis.every((y) => y.agg === 'none')).toBe(true);
    expect(out.geoPoint).toEqual({ mode: 'columns' });
  });

  it('geoscatter 검증 — 경도·위도 숫자 필수, 최대 2컬럼', () => {
    // 정상: 경도=amount(숫자), 위도=id(숫자)
    expect(builderValidationIssue(bar({ xAxis: 'amount', yAxis: [{ column: 'id', agg: 'none' }] }), 'geoscatter', TABLES)).toBeNull();
    // 텍스트 X(category) → 거부
    expect(builderValidationIssue(bar({ xAxis: 'category', yAxis: [{ column: 'id', agg: 'none' }] }), 'geoscatter', TABLES))
      .toBe('지도 포인트는 숫자 경도(X) 컬럼이 필요합니다.');
    // 3컬럼 → 거부
    expect(builderValidationIssue(bar({ xAxis: 'amount', yAxis: [{ column: 'id', agg: 'none' }, { column: 'amount', agg: 'none' }, { column: 'customer_id', agg: 'none' }] }), 'geoscatter', TABLES))
      .toBe('지도 포인트는 위도(+선택 크기값) 최대 2개 컬럼만 사용할 수 있습니다.');
    // 비숫자 위도 → 거부
    expect(builderValidationIssue(bar({ xAxis: 'amount', yAxis: [{ column: 'category', agg: 'none' }] }), 'geoscatter', TABLES))
      .toBe('지도 포인트의 위도·크기값 컬럼은 숫자여야 합니다.');
  });

  it('geoscatter 공간 Point 모드는 X/Y 대신 Point와 선택 크기 컬럼을 검증한다', () => {
    const spatial = bar({
      xAxis: null,
      yAxis: [],
      geoPoint: { mode: 'spatial', spatialColumn: 'location', sizeColumn: 'amount' },
    });
    expect(builderValidationIssue(spatial, 'geoscatter', TABLES)).toBeNull();

    const normalized = normalizeBuilderForChartType({ ...spatial, xAxis: 'amount', orderBy: { target: 'x', direction: 'asc' } }, 'geoscatter');
    expect(normalized).toMatchObject({ xAxis: null, yAxis: [], orderBy: null, sample: null, geoPoint: spatial.geoPoint });

    expect(builderValidationIssue({ ...spatial, geoPoint: { mode: 'spatial', spatialColumn: 'service_area' } }, 'geoscatter', TABLES))
      .toBe('지도 포인트 공간 컬럼은 SRID가 지정된 geometry/geography Point 타입이어야 합니다.');
    expect(builderValidationIssue({ ...spatial, geoPoint: { mode: 'spatial', spatialColumn: 'location', sizeColumn: 'category' } }, 'geoscatter', TABLES))
      .toBe('지도 포인트의 크기값 컬럼은 숫자여야 합니다.');

    const crossSource = {
      ...spatial,
      joins: [{ table: users2Ref, type: 'left' as const, on: { leftColumn: 'sales.customer_id', rightColumn: 'users.id' } }],
      geoPoint: { mode: 'spatial' as const, spatialColumn: 'sales.location', sizeColumn: 'sales.amount' },
    };
    expect(builderValidationIssue(crossSource, 'geoscatter', TABLES))
      .toBe('공간 Point 컬럼은 여러 데이터소스 조인에서 아직 사용할 수 없습니다.');
  });

  it('map 공간 Polygon 모드는 경계·이름·숫자값 컬럼을 검증하고 X/Y를 비운다', () => {
    const spatial = bar({
      xAxis: null,
      yAxis: [],
      geoArea: { mode: 'spatial', spatialColumn: 'service_area', nameColumn: 'category', valueColumn: 'amount' },
    });
    expect(builderValidationIssue(spatial, 'map', TABLES)).toBeNull();

    const geography = { ...spatial, geoArea: { ...spatial.geoArea!, spatialColumn: 'service_area_geog' } };
    expect(builderValidationIssue(geography, 'map', TABLES)).toBeNull();

    const normalized = normalizeBuilderForChartType({ ...spatial, xAxis: 'category', yAxis: [{ column: 'amount', agg: 'sum' }] }, 'map');
    expect(normalized).toMatchObject({ xAxis: null, yAxis: [], orderBy: null, sample: null, geoArea: spatial.geoArea });

    expect(builderValidationIssue({ ...spatial, geoArea: { ...spatial.geoArea!, spatialColumn: 'location' } }, 'map', TABLES))
      .toBe('동적 지도 경계는 SRID가 지정된 geometry/geography Polygon 또는 MultiPolygon 타입이어야 합니다.');
    expect(builderValidationIssue({ ...spatial, geoArea: { ...spatial.geoArea!, valueColumn: 'category' } }, 'map', TABLES))
      .toBe('동적 지도의 값 컬럼은 숫자여야 합니다.');

    const crossSource = {
      ...spatial,
      joins: [{ table: users2Ref, type: 'left' as const, on: { leftColumn: 'sales.customer_id', rightColumn: 'users.id' } }],
      geoArea: { mode: 'spatial' as const, spatialColumn: 'sales.service_area', nameColumn: 'sales.category', valueColumn: 'sales.amount' },
    };
    expect(builderValidationIssue(crossSource, 'map', TABLES))
      .toBe('공간 Polygon 컬럼은 여러 데이터소스 조인에서 아직 사용할 수 없습니다.');
  });
});
