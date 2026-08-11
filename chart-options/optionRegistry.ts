/**
 * 차트 시각화 옵션 레지스트리 (Single Source of Truth)
 * ------------------------------------------------------------------
 * 이 파일 하나가 세 곳을 동시에 구동한다.
 *   1) Admin 옵션 패널  : 이 목록을 렌더 (zone → section 순서, appliesTo·showIf 필터)
 *   2) mc_chart.options : 각 def.key 가 JSONB 키 경로 (PRD 9.2)
 *   3) 서버 변환기       : def.echarts 경로로 ECharts option 조립 (변환기 매핑 스펙 참조)
 *
 * 설계 축 2개 (서로 직교):
 *   - zone  : 옵션이 차트 종류와 어떻게 엮이는가 → 패널 배치 + 전환 시 유지/초기화 정책
 *       common : 모든 대분류 공통       → 대분류 전환 시 유지
 *       axis   : 직교 차트(막대·선·산점도) → 직교끼리 유지, 원형 전환 시 숨김+보존
 *       type   : 대분류 전용            → 대분류 전환 시 초기화(+토스트·실행취소)
 *   - tier  : 구현 시급도 (언제 만드는가) → T1 = MVP 기본 품질, T2 = 자주, T3 = 고급
 *
 * 관련 문서: PRD v1.6 (7.2 전환규칙 · 9.2 options 키) / 화면설계서 v2.4 (4.4 옵션 패널)
 * 대상 라이브러리: Apache ECharts v6.1.0
 */

import {
  COLORBREWER_CHOICES,
  DEFAULT_COLOR_THEME,
  DEFAULT_PALETTE,
  DEFAULT_PALETTE_PRESET,
  DEFAULT_SEQUENTIAL_PRESET,
  colorBrewerPalette,
  defaultPalettePresetForChartType,
  normalizeColorTheme,
  switchPaletteForChartType,
} from '@chartsdk/chart-options/palettes';
import {
  DEFAULT_BOXPLOT_OUTLIERS,
  DEFAULT_MOVING_AVERAGE,
} from '@chartsdk/chart-options/statisticalOverlays';
import { CHART_SIZE_PRESETS, FONT_FAMILY_CHOICES } from '@chartsdk/chart-options/display';

// ── 기본 타입 ─────────────────────────────────────────────────────

export type MajorType = 'bar' | 'line' | 'pie' | 'scatter' | 'boxplot' | 'heatmap' | 'map' | 'geoscatter';
export type Zone = 'common' | 'axis' | 'type';
export type Tier = 'T1' | 'T2' | 'T3';
export type OptionEditorTab = 'basic' | 'series' | 'axis' | 'area' | 'style' | 'interaction' | 'data';

/** 활성 대분류 런타임 목록 (MajorType 의 단일 진실원 — 패널 그리드·기본값 생성·전환이 공유) */
export const MAJOR_TYPES: MajorType[] = ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'];

/** 대분류의 사용자 표시 이름·그룹. Admin 목록/카드/옵션 패널이 같은 라벨을 사용한다. */
export const MAJOR_TYPE_CHOICES: { value: MajorType; label: string; group?: string }[] = [
  { value: 'bar', label: '막대' },
  { value: 'line', label: '선' },
  { value: 'pie', label: '원형' },
  { value: 'scatter', label: '산점도' },
  { value: 'boxplot', label: '박스 플롯' },
  { value: 'heatmap', label: '행렬 히트맵' },
  { value: 'map', label: '영역 지도', group: 'GEO' },
  { value: 'geoscatter', label: '포인트 지도', group: 'GEO' },
];

/** 패널 컨트롤 종류 — 공통 컴포넌트(화면설계서 2.4)와 1:1 */
export type Control =
  | 'iconGrid'   // 대분류 선택 (아이콘 4)
  | 'segment'    // 세그먼트 버튼 그룹
  | 'select'     // 드롭다운
  | 'text'       // 한 줄 입력
  | 'textarea'   // 여러 줄 입력
  | 'number'     // 숫자 입력
  | 'slider'     // 슬라이더
  | 'toggle'     // 스위치
  | 'color'      // 단일 컬러 피커
  | 'palette'    // 팔레트 프리셋 선택
  | 'colorMap'   // 항목별 컬러 피커 (실행 후 동적)
  | 'columnRef'  // 결과 컬럼 참조 셀렉트 (버블 크기 등, 실행 후 동적)
  | 'seriesTypes' // 시리즈별 막대/선 지정 (혼합 차트, 실행 후 동적)
  | 'tooltipFields' // 현재 차트에 연결된 실제 필드별 툴팁 표시 여부
  | 'analysisAnnotations' // 기준선·기준 범위·목표점 목록
  | 'boxplotOutliers' // 박스플롯 IQR 이상치 표시
  | 'movingAverage' // 시간축 단순 이동평균
  | 'mapViewport' // 지도 표시 영역(데이터·지역·지도 조정·좌표)
  | 'button';    // 액션 (저장 안 됨)

/** 옵션 값 저장 위치 */
export type Storage =
  | 'jsonb'   // mc_chart.options JSONB (def.key = 점 경로)
  | 'column'  // mc_chart 전용 컬럼 (def.column 에 컬럼명)
  | 'none';   // 저장 안 함 (button 등)

/** options 상태 객체 (중첩 JSONB 형태) */
export type Options = Record<string, any>;

export interface OptionDef {
  /** options JSONB 점 경로 (예: 'legend.position'). storage='column'이면 패널 상태 경로 */
  key: string;
  zone: Zone;
  /** 패널 접이식 섹션 라벨 */
  section: string;
  label: string;
  control: Control;
  /** 기본값. 대분류별로 다르면 defaultByType 사용 */
  default?: unknown;
  defaultByType?: Partial<Record<MajorType, unknown>>;
  /** 노출 대분류 (전환 시 패널 필터) */
  appliesTo: MajorType[];
  /** 조건부 노출 (variant·모드 의존). true 반환 시에만 렌더 */
  showIf?: (o: Options) => boolean;
  /** ECharts option 경로 힌트. variant·특수 케이스는 변환기가 별도 처리 ('@'로 시작) */
  echarts: string;
  storage?: Storage;        // 기본 'jsonb'
  column?: string;          // storage='column'일 때 mc_chart 컬럼명
  tier?: Tier;              // 미지정 = T1
  /** select/segment/iconGrid 선택지. group 은 iconGrid 의 시각 그룹핑(예: 'GEO') — 값·저장과 무관한 표시 계층 */
  choices?: { value: string | number; label: string; group?: string }[];
  /** slider/number 범위 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;            // 슬라이더 단위 표기 (px, ° 등)
  help?: string;            // 패널 도움말 / 문서 비고
}

// ── 중분류(variant) 정의 ──────────────────────────────────────────
// variant 는 단순 속성 토글뿐 아니라 series.type 교체까지 허용한다.
//   type  : series.type 오버라이드 (없으면 대분류 기본 type)
//   delta : 변환기가 시리즈에 머지할 옵션 조각
//   flags : 변환기가 해석하는 의미 플래그 (축 교환·스택 등)

export interface VariantDef {
  value: string;
  label: string;
  type?: string;
  delta?: Record<string, any>;
  flags?: Record<string, any>;
  help?: string;
}

export const VARIANTS: Record<MajorType, VariantDef[]> = {
  bar: [
    { value: 'basic',      label: '기본' },
    { value: 'stacked',    label: '누적',   flags: { stack: 'total' } },
    { value: 'grouped',    label: '그룹',   help: '시리즈 2개 이상일 때만 의미 있음 (스택 없음)' },
    { value: 'horizontal', label: '가로',   flags: { swapAxis: true } },
  ],
  line: [
    { value: 'basic',       label: '기본' },
    { value: 'smooth',      label: '곡선',     delta: { smooth: true } },
    { value: 'area',        label: '영역',     delta: { areaStyle: {} } },
    { value: 'stackedArea', label: '누적영역', delta: { areaStyle: {} }, flags: { stack: 'total' } },
    { value: 'step',        label: '계단',     delta: { step: 'end' } },
  ],
  pie: [
    { value: 'pie',   label: '파이' },
    { value: 'donut', label: '도넛', flags: { donut: true } },
    { value: 'rose',  label: '로즈', delta: { roseType: 'radius' } },
  ],
  scatter: [
    { value: 'scatter', label: '산점도' },
    { value: 'bubble',  label: '버블', flags: { bubble: true }, help: '버블 크기 컬럼을 symbolSize 로 인코딩' },
  ],
  // 통계·행렬형은 기본형 하나, 지도 대분류는 ECharts 지리 시리즈별 중분류를 제공한다.
  boxplot: [
    { value: 'basic', label: '기본', help: '카테고리별 5수 요약(min·Q1·중앙값·Q3·max) 박스 플롯' },
  ],
  heatmap: [
    { value: 'basic', label: '기본', help: 'X·Y 카테고리 매트릭스를 색 강도로 인코딩(visualMap)' },
  ],
  map: [
    { value: 'map', label: '영역', type: 'map', help: '지역명 또는 Polygon/MultiPolygon별 값을 색으로 인코딩' },
    { value: 'heatmap', label: '히트맵', type: 'heatmap', help: '경도·위도 또는 Point 밀도를 지도 위 색 강도로 표시' },
  ],
  geoscatter: [
    { value: 'scatter', label: '포인트', type: 'scatter', help: '지도 위에 일반 포인트를 표시' },
    { value: 'effectScatter', label: '효과 포인트', type: 'effectScatter', help: '지도 위 포인트에 ECharts 파동 효과를 표시' },
  ],
};

// ── 공통 선택지 상수 ──────────────────────────────────────────────

const FORMAT_CHOICES = [
  { value: 'raw',      label: '원본' },
  { value: 'comma',    label: '천단위 (1,000)' },
  { value: 'decimal0', label: '정수 반올림' },
  { value: 'decimal1', label: '소수 1자리' },
  { value: 'percent',  label: '백분율 (%)' },
];

// ── 레지스트리 본체 ───────────────────────────────────────────────

export const OPTION_REGISTRY: OptionDef[] = [
  // ════════════════════════════ ZONE 1 · 공통 ════════════════════════════

  // ── 기본 ──
  // chartType·variant 의 편집 UI 는 Admin 의 ChartTypeSelector(중앙 「차트 종류」 그룹)가 단독으로 소유한다.
  // 시각화 옵션 패널은 visualOptionDefinitions 로 이 두 키를 걸러내므로 OptionControl 에 렌더러를 두지 않는다.
  // 여기 정의는 저장 계약(chart_type 컬럼 / options.variant)과 서버 변환기 매핑을 위해 유지한다.
  {
    key: 'chartType', zone: 'common', section: '기본', label: '대분류',
    control: 'iconGrid', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'],
    storage: 'column', column: 'chart_type', default: 'bar', echarts: '@series.type',
    choices: MAJOR_TYPE_CHOICES,
    help: '지리 계열은 GEO 그룹으로 표시(화면설계 S2 차트 종류 그룹). 후속 geo 차트(경로 등)는 GEO 그룹에 추가',
  },
  {
    key: 'variant', zone: 'common', section: '기본', label: '중분류',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'],
    defaultByType: { bar: 'basic', line: 'basic', pie: 'pie', scatter: 'scatter', boxplot: 'basic', heatmap: 'basic', map: 'map', geoscatter: 'scatter' },
    echarts: '@variant',
    help: '선택지는 VARIANTS[chartType] 에서 동적으로 채운다 (대분류 종속)',
  },
  {
    key: 'title', zone: 'common', section: '기본', label: '차트 제목',
    control: 'text', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: '',
    echarts: 'title.text',
  },
  {
    key: 'titleH', zone: 'common', section: '기본', label: '제목 가로 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'center',
    echarts: 'title.left',
    choices: [{ value: 'left', label: '좌' }, { value: 'center', label: '중앙' }, { value: 'right', label: '우' }],
  },
  {
    key: 'titleV', zone: 'common', section: '기본', label: '제목 세로 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'top',
    echarts: 'title.top',
    choices: [{ value: 'top', label: '상' }, { value: 'bottom', label: '하' }],
  },
  {
    key: 'titleDirection', zone: 'common', section: '기본', label: '제목 텍스트 방향',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'horizontal',
    tier: 'T2', echarts: '@title.direction',
    choices: [{ value: 'horizontal', label: '가로' }, { value: 'vertical', label: '세로' }],
    help: '세로는 글자를 한 줄에 하나씩 아래로 쌓아 씁니다. 제목이 길수록 차트 영역이 줄어듭니다.',
  },
  {
    key: 'typography.titleFontFamily', zone: 'common', section: '기본', label: '제목 글꼴',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'default',
    echarts: 'title.textStyle.fontFamily',
    choices: FONT_FAMILY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
    help: '기본은 ECharts 시스템 글꼴을 유지합니다. Pretendard와 Noto Sans KR은 ChartSDK가 함께 배포해 미리보기와 임베드에서 동일하게 표시합니다.',
  },
  {
    key: 'typography.titleFontSize', zone: 'common', section: '기본', label: '제목 글자 크기',
    control: 'slider', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: null,
    min: 10, max: 48, step: 1, unit: 'px', echarts: 'title.textStyle.fontSize',
    help: '비워 두면 설계 크기와 전체 글자 크기 배율을 따릅니다.',
  },
  {
    key: 'description', zone: 'common', section: '기본', label: '설명',
    control: 'textarea', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: '',
    storage: 'column', column: 'description', echarts: '@none',
    help: 'S1 카드 표시·검색용. option 미반영 (차트 메타)',
  },

  // ── 크기 ──
  {
    key: 'display.preset', zone: 'common', section: '크기', label: '설계 크기',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'standard',
    echarts: '@display.size',
    choices: [
      ...CHART_SIZE_PRESETS.map((item) => ({ value: item.preset, label: item.label })),
      { value: 'custom', label: '사용자 지정' },
    ],
    help: '미리보기의 논리 캔버스와 자동 글꼴 기준. 임베드 호스트의 CSS width·height를 강제로 덮어쓰지 않는다',
  },
  {
    key: 'display.width', zone: 'common', section: '크기', label: '사용자 너비',
    control: 'number', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 640,
    showIf: (o) => o.display?.preset === 'custom', min: 240, max: 3840, unit: 'px', echarts: '@display.width',
  },
  {
    key: 'display.height', zone: 'common', section: '크기', label: '사용자 높이',
    control: 'number', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 360,
    showIf: (o) => o.display?.preset === 'custom', min: 180, max: 2160, unit: 'px', echarts: '@display.height',
  },

  // ── 글꼴 ──
  // 요소별 글꼴과 글자 크기는 그 요소를 편집하는 섹션(기본·범례·축 글자·라벨·툴팁 모양)에 있다.
  // 여기에는 자동 상태인 모든 요소에 걸리는 전체 배율만 남긴다.
  {
    key: 'typography.scale', zone: 'common', section: '글꼴', label: '전체 글자 크기',
    control: 'slider', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 100,
    min: 80, max: 150, step: 5, unit: '%', echarts: '@typography.scale',
    help: '자동 상태인 요소에만 적용됩니다. 크기를 직접 지정한 요소는 이 배율의 영향을 받지 않습니다.',
  },

  // ── 색상 ──
  // boxplot: 팔레트/개별색 = 상자 색. heatmap·map은 연속형 팔레트 전체를 visualMap에 쓰되 선택한 항목의 itemStyle이 우선한다.
  {
    key: 'palettePreset', zone: 'common', section: '색상', label: '테마',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'],
    default: DEFAULT_PALETTE_PRESET,
    defaultByType: { heatmap: DEFAULT_SEQUENTIAL_PRESET, map: DEFAULT_SEQUENTIAL_PRESET },
    echarts: '@palettePreset',
    choices: COLORBREWER_CHOICES,
    help: '일반 차트에는 정성형, 영역 지도와 히트맵에는 순차형·발산형 ColorBrewer 팔레트를 제공합니다.',
  },
  {
    key: 'palette', zone: 'common', section: '색상', label: '테마 색상',
    control: 'palette', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'],
    default: DEFAULT_PALETTE,
    defaultByType: {
      heatmap: colorBrewerPalette(DEFAULT_SEQUENTIAL_PRESET),
      map: colorBrewerPalette(DEFAULT_SEQUENTIAL_PRESET),
    },
    echarts: 'color',
    help: '시리즈 또는 차트에서 선택한 요소에 팔레트 색상을 적용합니다. 직접 지정한 색은 테마를 바꿔도 유지되고, 지정 해제하면 현재 테마색으로 돌아갑니다.',
  },
  {
    key: 'paletteReversed', zone: 'common', section: '색상', label: '색상 방향 반전',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: false,
    echarts: '@visualMap.inRange.color.reverse',
    help: '순차형·발산형 팔레트의 진행 방향을 서로 바꿉니다.',
  },
  {
    key: 'colorMap', zone: 'common', section: '색상', label: '시리즈 색상',
    control: 'colorMap', appliesTo: MAJOR_TYPES, default: {},
    echarts: '@colorMap',
    help: '시리즈 목록과 차트에서 선택한 단일 요소 목록을 따로 관리합니다. 차트 요소는 현재 선택 삭제 또는 모두 삭제할 수 있습니다.',
  },

  // ── 범례 ──
  // 단일 heatmap·map은 visualMap이 값 범례를 담당하고, 지도 계열이 둘 이상이면 계열 범례도 함께 사용한다.
  {
    key: 'legend.show', zone: 'common', section: '범례', label: '범례 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'map', 'geoscatter'], default: true,
    echarts: 'legend.show',
  },
  {
    key: 'legend.position', zone: 'common', section: '범례', label: '위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'map', 'geoscatter'], default: 'bottom',
    showIf: (o) => o.legend?.show !== false,
    echarts: '@legend.position',
    choices: [
      { value: 'top', label: '상' }, { value: 'bottom', label: '하' },
      { value: 'left', label: '좌' }, { value: 'right', label: '우' },
    ],
    help: '좌/우 선택 시 변환기가 legend.orient=vertical 로 자동 설정',
  },
  {
    key: 'legend.scroll', zone: 'common', section: '범례', label: '좌·우 범례 스크롤',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'map', 'geoscatter'], default: false, tier: 'T2',
    showIf: (o) => o.legend?.show !== false && (o.legend?.position === 'left' || o.legend?.position === 'right'),
    echarts: '@legend.type',
    help: '상·하 범례는 단일행을 보장하기 위해 항상 scroll. 좌·우만 이 토글로 페이지네이션을 켠다',
  },
  {
    key: 'typography.legendFontFamily', zone: 'common', section: '범례', label: '글꼴',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'default',
    echarts: 'legend.textStyle.fontFamily',
    choices: FONT_FAMILY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
    help: '행렬 히트맵·영역 지도에서는 색상 범례 글꼴에 적용됩니다.',
  },
  {
    key: 'typography.legendFontSize', zone: 'common', section: '범례', label: '글자 크기',
    control: 'slider', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: null,
    min: 8, max: 32, step: 1, unit: 'px', echarts: 'legend.textStyle.fontSize',
    help: '비워 두면 설계 크기와 전체 글자 크기 배율을 따릅니다. 행렬 히트맵·영역 지도에서는 색상 범례 글자에 적용됩니다.',
  },

  // ── 툴팁 ──
  // 사용자에게 실제로 다른 두 동작만 노출한다. item은 단일 데이터, axis는 같은 축의 계열 묶음이다.
  {
    key: 'tooltip.enabled', zone: 'common', section: '툴팁', label: '툴팁 표시',
    control: 'toggle', appliesTo: MAJOR_TYPES, default: true,
    echarts: 'tooltip.show',
  },
  {
    key: 'tooltip.trigger', zone: 'common', section: '툴팁', label: '표시 기준',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap'], default: 'item',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.trigger',
    choices: [{ value: 'item', label: '항목' }, { value: 'axis', label: '축' }],
    help: '항목은 마우스를 올린 데이터 하나, 축은 같은 축 위치의 여러 계열을 함께 표시합니다.',
  },
  {
    key: 'tooltip.valueFormat', zone: 'common', section: '툴팁', label: '값 포맷',
    control: 'select', appliesTo: MAJOR_TYPES, default: 'raw',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: '@tooltip.valueFormatter', choices: FORMAT_CHOICES,
  },
  {
    key: 'tooltip.axisPointer', zone: 'common', section: '툴팁', label: '축 지시선',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'auto',
    showIf: (o) => o.tooltip?.enabled !== false && o.tooltip?.trigger === 'axis',
    echarts: 'tooltip.axisPointer.type',
    choices: [{ value: 'auto', label: '자동' }, { value: 'line', label: '선' }, { value: 'shadow', label: '음영' }, { value: 'cross', label: '십자' }],
  },
  {
    key: 'tooltip.confine', zone: 'common', section: '툴팁', label: '표시 영역',
    control: 'select', appliesTo: MAJOR_TYPES, default: 'auto',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.confine',
    choices: [{ value: 'auto', label: '자동' }, { value: 'inside', label: '차트 안쪽' }, { value: 'free', label: '바깥 허용' }],
    help: '자동은 ECharts 기본 배치입니다. 임베드 컨테이너에서 잘리면 차트 안쪽을 선택하세요.',
  },
  {
    key: 'tooltip.backgroundColor', zone: 'common', section: '툴팁', label: '배경색',
    control: 'color', appliesTo: MAJOR_TYPES, default: '#FFFFFF',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.backgroundColor',
    help: 'ECharts 6.1 기본값은 흰색(#FFFFFF)입니다.',
  },
  {
    key: 'tooltip.textColor', zone: 'common', section: '툴팁', label: '글자색',
    control: 'color', appliesTo: MAJOR_TYPES, default: '#6D6E73',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.textStyle.color',
    help: 'ECharts 6.1 기본값은 #6D6E73입니다.',
  },
  {
    key: 'tooltip.borderColor', zone: 'common', section: '툴팁', label: '테두리 색상',
    control: 'color', appliesTo: MAJOR_TYPES, default: null,
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.borderColor',
    help: '기본은 ECharts가 현재 데이터 항목의 색상을 자동 사용합니다. 색을 고르면 고정 색상으로 바뀝니다.',
  },
  {
    key: 'tooltip.borderWidth', zone: 'common', section: '툴팁', label: '테두리 두께',
    control: 'number', appliesTo: MAJOR_TYPES, default: 1,
    showIf: (o) => o.tooltip?.enabled !== false,
    min: 0, max: 10, step: 1, unit: 'px', echarts: 'tooltip.borderWidth',
  },
  {
    key: 'tooltip.padding', zone: 'common', section: '툴팁', label: '내부 여백',
    control: 'number', appliesTo: MAJOR_TYPES, default: 10,
    showIf: (o) => o.tooltip?.enabled !== false,
    min: 0, max: 40, step: 1, unit: 'px', echarts: 'tooltip.padding',
    help: '브라우저 HTML 툴팁에서 ECharts 기본 계산값은 10px입니다.',
  },
  {
    key: 'typography.tooltipFontFamily', zone: 'common', section: '툴팁', label: '글꼴',
    control: 'select', appliesTo: MAJOR_TYPES, default: 'default',
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: 'tooltip.textStyle.fontFamily',
    choices: FONT_FAMILY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
  },
  {
    key: 'typography.tooltipFontSize', zone: 'common', section: '툴팁', label: '글자 크기',
    control: 'slider', appliesTo: MAJOR_TYPES, default: null,
    showIf: (o) => o.tooltip?.enabled !== false,
    min: 8, max: 32, step: 1, unit: 'px', echarts: 'tooltip.textStyle.fontSize',
    help: '비워 두면 설계 크기와 전체 글자 크기 배율을 따릅니다.',
  },
  {
    key: 'tooltip.fields', zone: 'common', section: '툴팁', label: '표시할 데이터',
    control: 'tooltipFields', appliesTo: MAJOR_TYPES, default: {},
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: '@tooltip.fields',
    help: '별칭이 있으면 별칭을 사용하고, 새로 연결된 필드는 자동으로 표시합니다.',
  },
  {
    key: 'tooltip.showSeriesColor', zone: 'common', section: '툴팁', label: '계열 색상 표시',
    control: 'toggle', appliesTo: MAJOR_TYPES, default: true,
    showIf: (o) => o.tooltip?.enabled !== false,
    echarts: '@tooltip.marker',
    help: '여러 계열이나 조각을 구분하는 작은 색상 표시입니다.',
  },

  // ── 강조 ──
  // enabled=true + 자동 설정은 emphasis를 만들지 않는다. ECharts 차트별 기본 강조와 병합 규칙을 그대로 쓴다.
  {
    key: 'emphasis.enabled', zone: 'common', section: '강조', label: '강조 효과',
    control: 'toggle', appliesTo: MAJOR_TYPES, default: true,
    echarts: 'series.emphasis.disabled',
  },
  {
    key: 'emphasis.focus', zone: 'common', section: '강조', label: '집중 범위',
    control: 'select', appliesTo: MAJOR_TYPES, default: 'auto',
    showIf: (o) => o.emphasis?.enabled !== false,
    echarts: 'series.emphasis.focus',
    choices: [
      { value: 'auto', label: '자동' },
      { value: 'none', label: '흐림 없음' },
      { value: 'self', label: '현재 항목' },
      { value: 'series', label: '현재 계열' },
    ],
    help: '현재 항목이나 계열을 선택하면 나머지 데이터가 흐려져 비교 대상에 집중할 수 있습니다.',
  },
  {
    key: 'emphasis.colorMode', zone: 'common', section: '강조', label: '강조 색상',
    control: 'segment', appliesTo: MAJOR_TYPES, default: 'auto',
    showIf: (o) => o.emphasis?.enabled !== false,
    echarts: '@emphasis.color',
    choices: [{ value: 'auto', label: '자동' }, { value: 'custom', label: '직접 지정' }],
    help: '자동은 막대 밝기, 선·점 크기, 지도 기본 금색 등 ECharts의 차트별 기본 효과를 유지합니다.',
  },
  {
    key: 'emphasis.color', zone: 'common', section: '강조', label: '사용자 강조 색상',
    control: 'color', appliesTo: MAJOR_TYPES, default: '#FFD700',
    showIf: (o) => o.emphasis?.enabled !== false && o.emphasis?.colorMode === 'custom',
    echarts: '@emphasis.color',
  },
  {
    key: 'emphasis.scale', zone: 'common', section: '강조', label: '크기 확대',
    control: 'toggle', appliesTo: ['line', 'pie', 'scatter', 'boxplot', 'geoscatter'], default: true,
    showIf: (o) => o.emphasis?.enabled !== false,
    echarts: 'series.emphasis.scale',
    help: 'ECharts 6.1에서 선·원형·산점도·박스 플롯의 기본값은 켜짐입니다.',
  },
  {
    key: 'emphasis.scaleSize', zone: 'common', section: '강조', label: '원형 확대 크기',
    control: 'slider', appliesTo: ['pie'], default: 5,
    showIf: (o) => o.emphasis?.enabled !== false && o.emphasis?.scale !== false,
    min: 0, max: 20, step: 1, unit: 'px', echarts: 'series.emphasis.scaleSize',
  },
  {
    key: 'emphasis.lineWidth', zone: 'common', section: '강조', label: '강조 선 굵기',
    control: 'number', appliesTo: ['line'], default: null,
    showIf: (o) => o.emphasis?.enabled !== false,
    min: 0, max: 20, step: 1, unit: 'px', echarts: 'series.emphasis.lineStyle.width',
    help: '비워두면 ECharts 기본값을 사용합니다.',
  },
  {
    key: 'emphasis.borderWidth', zone: 'common', section: '강조', label: '박스 테두리 굵기',
    control: 'slider', appliesTo: ['boxplot'], default: 2,
    showIf: (o) => o.emphasis?.enabled !== false,
    min: 0, max: 10, step: 1, unit: 'px', echarts: 'series.emphasis.itemStyle.borderWidth',
    help: 'ECharts 6.1 박스 플롯 기본값은 2px입니다.',
  },

  // ── 계열 ──
  {
    key: 'dataLabel', zone: 'common', section: '계열', label: '데이터 라벨 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'map', 'geoscatter'], default: false,
    echarts: 'series.label.show',
    help: 'heatmap = 셀 값, map = 지역명 라벨',
  },
  {
    key: 'typography.dataLabelFontFamily', zone: 'common', section: '계열', label: '라벨 글꼴',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'map', 'geoscatter'], default: 'default',
    showIf: (o) => o.dataLabel === true,
    echarts: 'series.label.fontFamily',
    choices: FONT_FAMILY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
  },
  {
    key: 'typography.dataLabelFontSize', zone: 'common', section: '계열', label: '라벨 글자 크기',
    control: 'slider', appliesTo: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'map', 'geoscatter'], default: null,
    showIf: (o) => o.dataLabel === true,
    min: 8, max: 32, step: 1, unit: 'px', echarts: 'series.label.fontSize',
    help: '비워 두면 설계 크기와 전체 글자 크기 배율을 따릅니다.',
  },
  {
    key: 'labelPosition', zone: 'common', section: '계열', label: '라벨 위치',
    control: 'select', appliesTo: ['bar', 'line'], tier: 'T2',
    defaultByType: { bar: 'top', line: 'top' },
    showIf: (o) => o.dataLabel === true,
    echarts: 'series.label.position',
    choices: [
      { value: 'top', label: '위' }, { value: 'inside', label: '안쪽' },
    ],
  },
  {
    key: 'labelRotate', zone: 'common', section: '계열', label: '라벨 텍스트 방향',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'heatmap', 'map', 'geoscatter'], default: 0, tier: 'T2',
    showIf: (o) => o.dataLabel === true,
    echarts: 'series.label.rotate',
    choices: [{ value: 0, label: '가로' }, { value: 90, label: '세로' }],
    help: '세로는 라벨을 90° 회전합니다. 라벨이 겹치거나 표시 공간이 좁을 때 사용합니다.',
  },
  {
    key: 'sortOrder', zone: 'common', section: '계열', label: '정렬',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'none',
    echarts: '@sort',
    choices: [{ value: 'none', label: '원본' }, { value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }],
    help: '서버에서 rows 정렬 (ECharts 옵션 아님)',
  },
  {
    key: 'analysis.boxplotOutliers', zone: 'common', section: '분석 표시', label: '이상치',
    control: 'boxplotOutliers', appliesTo: ['boxplot'],
    default: DEFAULT_BOXPLOT_OUTLIERS, tier: 'T2',
    echarts: '@analysis.boxplotOutliers',
    help: '1.5 × IQR 범위 밖의 값을 별도 산점도 계열로 표시합니다.',
  },
  {
    key: 'analysis.movingAverage', zone: 'common', section: '분석 표시', label: '이동평균',
    control: 'movingAverage', appliesTo: ['line'],
    default: DEFAULT_MOVING_AVERAGE, tier: 'T2',
    echarts: '@analysis.movingAverage',
    help: '날짜·시간 X축을 오름차순 정렬해 선택 계열의 단순 이동평균을 계산합니다.',
  },
  {
    key: 'analysis.annotations', zone: 'common', section: '분석 표시', label: '기준·목표',
    control: 'analysisAnnotations', appliesTo: ['bar', 'line', 'scatter', 'boxplot'],
    default: { lines: [], ranges: [], targets: [] }, tier: 'T2',
    echarts: '@analysis.annotations',
    help: '값 축 기준선·범위와 특정 X 위치의 목표점을 여러 개 추가합니다.',
  },

  // ── 데이터 갱신 ──
  {
    key: 'refreshMode', zone: 'common', section: '데이터 갱신', label: '갱신 모드',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: 'manual',
    storage: 'column', column: 'refresh_mode', echarts: '@none',
    choices: [{ value: 'manual', label: '수동' }, { value: 'live', label: '항상 최신 조회' }],
    help: '수동 스냅샷 또는 요청마다 최신 조회 중 하나를 선택합니다.',
  },
  {
    key: 'refreshNow', zone: 'common', section: '데이터 갱신', label: '지금 갱신',
    control: 'button', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], tier: 'T2',
    storage: 'none', echarts: '@none',
    help: '저장된 차트 스냅샷을 즉시 다시 계산하고 마지막 계산 시각과 미리보기를 갱신합니다.',
  },
  {
    key: 'showComputedAt', zone: 'common', section: '데이터 갱신', label: '데이터 기준 시각 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'], default: true,
    showIf: (o) => o.refreshMode !== 'live',
    echarts: '@caption.computedAt',
    help: 'S4 "데이터 기준 {시각}" 캡션 (수동 모드일 때만)',
  },

  // ════════════════════════════ ZONE 2 · 좌표/축 ════════════════════════════
  // 직교 차트(막대·선·산점도)만. 원형 전환 시 숨김+보존(복귀 시 복원).

  // ── 축 글자 ──
  {
    key: 'typography.axisFontFamily', zone: 'axis', section: '축 글자', label: '글꼴',
    control: 'select', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'default',
    echarts: '@axis.fontFamily',
    choices: FONT_FAMILY_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
    help: 'X·Y 축 제목과 축 레이블에 함께 적용됩니다.',
  },
  {
    key: 'typography.axisFontSize', zone: 'axis', section: '축 글자', label: '글자 크기',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: null,
    min: 8, max: 32, step: 1, unit: 'px', echarts: '@axis.fontSize',
    help: 'X·Y 축의 라벨과 제목에 함께 적용됩니다. 비워 두면 설계 크기와 전체 글자 크기 배율을 따릅니다.',
  },

  // ── 여백 ──
  {
    key: 'grid.containLabel', zone: 'axis', section: '여백', label: '라벨 잘림 방지',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: true,
    echarts: 'grid.containLabel',
    help: 'T1 — 긴 축 라벨이 플롯 밖으로 잘리는 것 방지',
  },
  {
    key: 'grid.preset', zone: 'axis', section: '여백', label: '여백 프리셋',
    control: 'select', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'normal',
    echarts: '@grid.preset',
    choices: [{ value: 'compact', label: '좁게' }, { value: 'normal', label: '보통' }, { value: 'loose', label: '넓게' }],
  },

  // ── X축 ──
  {
    key: 'xAxis.title', zone: 'axis', section: 'X축', label: '제목',
    control: 'text', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: '',
    echarts: 'xAxis.name',
  },
  {
    key: 'xAxis.titleLocation', zone: 'axis', section: 'X축', label: '제목 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'middle',
    echarts: 'xAxis.nameLocation',
    choices: [{ value: 'start', label: '시작' }, { value: 'middle', label: '가운데' }, { value: 'end', label: '끝' }],
  },
  {
    key: 'xAxis.titleGap', zone: 'axis', section: 'X축', label: '제목 간격',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 56,
    showIf: (o) => (o.xAxis?.titleLocation ?? 'middle') === 'middle',
    min: 0, max: 160, step: 1, unit: 'px', echarts: 'xAxis.nameGap',
    help: '가운데 제목과 축 사이의 간격입니다. 시작·끝 제목은 잘리지 않도록 끝점 여백을 자동으로 계산합니다.',
  },
  {
    key: 'xAxis.titleRotate', zone: 'axis', section: 'X축', label: '제목 회전',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 0,
    min: -180, max: 180, step: 5, unit: '°', echarts: 'xAxis.nameRotate',
  },
  {
    key: 'xAxis.position', zone: 'axis', section: 'X축', label: '축 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'bottom',
    echarts: 'xAxis.position',
    choices: [{ value: 'bottom', label: '아래' }, { value: 'top', label: '위' }],
  },
  {
    key: 'xAxis.verticalLabels', zone: 'axis', section: 'X축', label: '라벨 세로쓰기',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: false,
    echarts: '@xAxis.axisLabel.verticalText',
    help: '한 글자씩 줄을 바꿔 위에서 아래로 쌓습니다. 라벨 회전과 함께 사용할 수 있습니다.',
  },
  {
    key: 'xAxis.rotate', zone: 'axis', section: 'X축', label: '라벨 회전',
    control: 'slider', appliesTo: ['bar', 'line', 'boxplot', 'heatmap'], default: 30,
    min: 0, max: 90, step: 5, unit: '°', echarts: 'xAxis.axisLabel.rotate',
    help: '범주형 X축 라벨을 기울여 겹침을 줄입니다.',
  },
  {
    key: 'xAxis.labelIntervalMode', zone: 'axis', section: 'X축', label: '라벨 표시',
    control: 'segment', appliesTo: ['bar', 'line', 'boxplot', 'heatmap'], default: 'all',
    echarts: '@xAxis.axisLabel.interval',
    choices: [
      { value: 'auto', label: '자동' },
      { value: 'all', label: '전체' },
      { value: 'step', label: '간격 지정' },
    ],
    help: '기본값은 전체 표시입니다. 자동은 공간에 따라 ECharts가 라벨을 생략합니다.',
  },
  {
    key: 'xAxis.labelEvery', zone: 'axis', section: 'X축', label: '표시 간격',
    control: 'number', appliesTo: ['bar', 'line', 'boxplot', 'heatmap'], default: 2,
    showIf: (o) => o.xAxis?.labelIntervalMode === 'step',
    min: 2, max: 100, step: 1, unit: '개마다', echarts: '@xAxis.axisLabel.interval',
    help: '예: 3이면 첫 라벨부터 3개마다 표시합니다.',
  },
  {
    key: 'xAxis.showMinLabel', zone: 'axis', section: 'X축', label: '첫 라벨 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'boxplot', 'heatmap'], default: true,
    echarts: 'xAxis.axisLabel.showMinLabel',
  },
  {
    key: 'xAxis.showMaxLabel', zone: 'axis', section: 'X축', label: '마지막 라벨 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'boxplot', 'heatmap'], default: true,
    echarts: 'xAxis.axisLabel.showMaxLabel',
  },
  {
    key: 'xAxis.splitLine', zone: 'axis', section: 'X축', label: '세로 격자선',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter'], default: false,
    echarts: 'xAxis.splitLine.show',
  },
  {
    key: 'xAxis.scale', zone: 'axis', section: 'X축', label: '스케일',
    control: 'segment', appliesTo: ['scatter'], default: 'value',
    showIf: (o) => o.chartType === 'scatter',
    echarts: '@xAxis.type',
    choices: [{ value: 'value', label: '선형' }, { value: 'log', label: '로그' }],
    help: '숫자 X축(산점도)에서만 유효. 카테고리 X축에선 무시',
  },
  {
    key: 'xAxis.tickMode', zone: 'axis', section: 'X축', label: '눈금 방식',
    control: 'segment', appliesTo: ['scatter'], default: 'auto',
    echarts: '@xAxis.interval',
    choices: [{ value: 'auto', label: '자동' }, { value: 'fixed', label: '고정 간격' }],
  },
  {
    key: 'xAxis.splitNumber', zone: 'axis', section: 'X축', label: '목표 구간 수',
    control: 'number', appliesTo: ['scatter'], default: 5,
    showIf: (o) => o.xAxis?.tickMode !== 'fixed' && o.xAxis?.scale !== 'log',
    min: 2, max: 20, step: 1, echarts: 'xAxis.splitNumber',
    help: '자동 눈금 계산 시 목표 구간 수이며 실제 구간 수는 달라질 수 있습니다.',
  },
  {
    key: 'xAxis.interval', zone: 'axis', section: 'X축', label: '고정 눈금 간격',
    control: 'number', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.xAxis?.tickMode === 'fixed' && o.xAxis?.scale !== 'log',
    min: 0.1, step: 0.1, echarts: 'xAxis.interval',
  },
  {
    key: 'xAxis.minInterval', zone: 'axis', section: 'X축', label: '최소 눈금 간격',
    control: 'number', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.xAxis?.tickMode !== 'fixed' && o.xAxis?.scale !== 'log',
    min: 0.1, step: 0.1, echarts: 'xAxis.minInterval',
  },
  {
    key: 'xAxis.maxInterval', zone: 'axis', section: 'X축', label: '최대 눈금 간격',
    control: 'number', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.xAxis?.tickMode !== 'fixed' && o.xAxis?.scale !== 'log',
    min: 0.1, step: 0.1, echarts: 'xAxis.maxInterval',
  },
  {
    key: 'xAxis.includeZero', zone: 'axis', section: 'X축', label: '0 포함',
    control: 'toggle', appliesTo: ['scatter'], default: true,
    showIf: (o) => o.xAxis?.scale !== 'log', echarts: '@xAxis.scale',
  },
  {
    key: 'xAxis.logBase', zone: 'axis', section: 'X축', label: '로그 기준값',
    control: 'number', appliesTo: ['scatter'], default: 10,
    showIf: (o) => o.xAxis?.scale === 'log',
    min: 2, max: 100, step: 1, echarts: 'xAxis.logBase',
  },
  {
    key: 'xAxis.min', zone: 'axis', section: 'X축', label: '최솟값',
    control: 'number', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.chartType === 'scatter', echarts: 'xAxis.min',
  },
  {
    key: 'xAxis.max', zone: 'axis', section: 'X축', label: '최댓값',
    control: 'number', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.chartType === 'scatter', echarts: 'xAxis.max',
  },

  // ── Y축 ──
  {
    key: 'yAxis.title', zone: 'axis', section: 'Y축', label: '제목',
    control: 'text', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: '',
    echarts: 'yAxis.name',
  },
  {
    key: 'yAxis.titleLocation', zone: 'axis', section: 'Y축', label: '제목 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'middle',
    echarts: 'yAxis.nameLocation',
    choices: [{ value: 'start', label: '시작' }, { value: 'middle', label: '가운데' }, { value: 'end', label: '끝' }],
  },
  {
    key: 'yAxis.titleGap', zone: 'axis', section: 'Y축', label: '제목 간격',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 56,
    showIf: (o) => (o.yAxis?.titleLocation ?? 'middle') === 'middle',
    min: 0, max: 160, step: 1, unit: 'px', echarts: 'yAxis.nameGap',
    help: '가운데 제목과 축 사이의 간격입니다. 시작·끝 제목은 잘리지 않도록 끝점 여백을 자동으로 계산합니다.',
  },
  {
    key: 'yAxis.titleRotate', zone: 'axis', section: 'Y축', label: '제목 회전',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: -90,
    min: -180, max: 180, step: 5, unit: '°', echarts: 'yAxis.nameRotate',
  },
  {
    key: 'yAxis.position', zone: 'axis', section: 'Y축', label: '축 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: 'left',
    echarts: 'yAxis.position',
    choices: [{ value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }],
  },
  {
    key: 'yAxis.verticalLabels', zone: 'axis', section: 'Y축', label: '라벨 세로쓰기',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter', 'boxplot', 'heatmap'], default: false,
    echarts: '@yAxis.axisLabel.verticalText',
    help: '한 글자씩 줄을 바꿔 위에서 아래로 쌓습니다. 라벨 회전과 함께 사용할 수 있습니다.',
  },
  {
    key: 'yAxis.labelIntervalMode', zone: 'axis', section: 'Y축', label: '라벨 표시',
    control: 'segment', appliesTo: ['heatmap'], default: 'auto',
    echarts: '@yAxis.axisLabel.interval',
    choices: [
      { value: 'auto', label: '자동' },
      { value: 'all', label: '전체' },
      { value: 'step', label: '간격 지정' },
    ],
    help: '범주형 Y축의 기본값은 자동 간격입니다.',
  },
  {
    key: 'yAxis.labelEvery', zone: 'axis', section: 'Y축', label: '표시 간격',
    control: 'number', appliesTo: ['heatmap'], default: 2,
    showIf: (o) => o.yAxis?.labelIntervalMode === 'step',
    min: 2, max: 100, step: 1, unit: '개마다', echarts: '@yAxis.axisLabel.interval',
  },
  {
    key: 'yAxis.showMinLabel', zone: 'axis', section: 'Y축', label: '첫 라벨 표시',
    control: 'toggle', appliesTo: ['heatmap'], default: true,
    echarts: 'yAxis.axisLabel.showMinLabel',
  },
  {
    key: 'yAxis.showMaxLabel', zone: 'axis', section: 'Y축', label: '마지막 라벨 표시',
    control: 'toggle', appliesTo: ['heatmap'], default: true,
    echarts: 'yAxis.axisLabel.showMaxLabel',
  },
  {
    key: 'yAxis.hideOverlap', zone: 'axis', section: 'Y축', label: '겹치는 라벨 숨기기',
    control: 'toggle', appliesTo: ['heatmap'], default: true,
    showIf: (o) => o.yAxis?.labelIntervalMode !== 'all',
    echarts: 'yAxis.axisLabel.hideOverlap',
  },
  {
    key: 'yAxis.unit', zone: 'axis', section: 'Y축', label: '단위 표기',
    control: 'text', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: '',
    echarts: '@yAxis.unit', help: '예: 원, %, 건. format과 결합되어 axisLabel.formatter 생성',
  },
  {
    key: 'yAxis.format', zone: 'axis', section: 'Y축', label: '라벨 포맷',
    control: 'select', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 'raw',
    echarts: '@yAxis.formatter', choices: FORMAT_CHOICES,
    help: 'T1 — 천단위 콤마/소수점. unit과 합쳐 최종 포맷터 구성',
  },
  {
    key: 'yAxis.rangeMode', zone: 'axis', section: 'Y축', label: '범위',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 'auto',
    echarts: '@yAxis.range',
    choices: [{ value: 'auto', label: '자동' }, { value: 'manual', label: '수동' }],
  },
  {
    key: 'yAxis.min', zone: 'axis', section: 'Y축', label: '최솟값',
    control: 'number', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: null,
    showIf: (o) => o.yAxis?.rangeMode === 'manual', echarts: 'yAxis.min',
  },
  {
    key: 'yAxis.max', zone: 'axis', section: 'Y축', label: '최댓값',
    control: 'number', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: null,
    showIf: (o) => o.yAxis?.rangeMode === 'manual', echarts: 'yAxis.max',
  },
  {
    key: 'yAxis.scale', zone: 'axis', section: 'Y축', label: '스케일',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 'value',
    echarts: '@yAxis.type',
    choices: [{ value: 'value', label: '선형' }, { value: 'log', label: '로그' }],
  },
  {
    key: 'yAxis.tickMode', zone: 'axis', section: 'Y축', label: '눈금 방식',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 'auto',
    echarts: '@yAxis.interval',
    choices: [{ value: 'auto', label: '자동' }, { value: 'fixed', label: '고정 간격' }],
    help: '기본값은 ECharts 자동 눈금 계산입니다.',
  },
  {
    key: 'yAxis.splitNumber', zone: 'axis', section: 'Y축', label: '목표 구간 수',
    control: 'number', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 5,
    showIf: (o) => o.yAxis?.tickMode !== 'fixed' && o.yAxis?.scale !== 'log',
    min: 2, max: 20, step: 1, echarts: 'yAxis.splitNumber',
    help: '자동 눈금 계산 시 목표 구간 수이며 실제 구간 수는 달라질 수 있습니다.',
  },
  {
    key: 'yAxis.interval', zone: 'axis', section: 'Y축', label: '고정 눈금 간격',
    control: 'number', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: null,
    showIf: (o) => o.yAxis?.tickMode === 'fixed' && o.yAxis?.scale !== 'log',
    min: 0.1, step: 0.1, echarts: 'yAxis.interval',
  },
  {
    key: 'yAxis.includeZero', zone: 'axis', section: 'Y축', label: '0 포함',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: true,
    showIf: (o) => o.yAxis?.scale !== 'log', echarts: '@yAxis.scale',
  },
  {
    key: 'yAxis.logBase', zone: 'axis', section: 'Y축', label: '로그 기준값',
    control: 'number', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: 10,
    showIf: (o) => o.yAxis?.scale === 'log',
    min: 2, max: 100, step: 1, echarts: 'yAxis.logBase',
  },
  {
    key: 'yAxis.splitLine', zone: 'axis', section: 'Y축', label: '가로 격자선',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter', 'boxplot'], default: true,
    echarts: 'yAxis.splitLine.show',
  },
  {
    key: 'yAxis.secondAxis', zone: 'axis', section: 'Y축', label: '2번째 Y축 (이중축)',
    control: 'toggle', appliesTo: ['bar', 'line'], default: false, tier: 'T1',
    echarts: '@yAxis.second',
    help: 'T1 — 단위 다른 두 지표. 켜면 시리즈별 축 배정 UI 노출(2번째 시리즈부터 우측 축). 변환기가 series.yAxisIndex 부여',
  },

  // ════════════════════════════ ZONE 3 · 대분류 전용 ════════════════════════════

  // ── 막대 ──
  {
    key: 'bar.width', zone: 'type', section: '막대', label: '막대 너비',
    control: 'slider', appliesTo: ['bar'], default: null,
    min: 0, max: 100, step: 1, unit: '%', echarts: 'series.barWidth',
    help: 'null = 자동. %는 카테고리 폭 대비',
  },
  {
    key: 'bar.gap', zone: 'type', section: '막대', label: '막대 간격',
    control: 'slider', appliesTo: ['bar'], default: 30, tier: 'T2',
    min: 0, max: 100, step: 5, unit: '%', echarts: 'series.barGap',
    help: '같은 카테고리 내 시리즈 간 간격',
  },
  {
    key: 'bar.borderRadius', zone: 'type', section: '막대', label: '둥근 모서리',
    control: 'slider', appliesTo: ['bar'], default: 0,
    min: 0, max: 20, step: 1, unit: 'px', echarts: 'series.itemStyle.borderRadius',
  },
  {
    key: 'bar.normalize', zone: 'type', section: '막대', label: '100% 정규화',
    control: 'toggle', appliesTo: ['bar'], default: false, tier: 'T2',
    showIf: (o) => o.variant === 'stacked',
    echarts: '@bar.normalize', help: '누적 시 각 카테고리를 100% 비율로 변환',
  },
  {
    key: 'bar.showBackground', zone: 'type', section: '막대', label: '배경 막대',
    control: 'toggle', appliesTo: ['bar'], default: false, tier: 'T2',
    echarts: 'series.showBackground',
  },

  // ── 선 ──
  {
    key: 'line.width', zone: 'type', section: '선', label: '선 굵기',
    control: 'slider', appliesTo: ['line'], default: 2,
    min: 1, max: 8, step: 1, unit: 'px', echarts: 'series.lineStyle.width',
  },
  {
    key: 'line.lineType', zone: 'type', section: '선', label: '선 종류',
    control: 'segment', appliesTo: ['line'], default: 'solid',
    echarts: 'series.lineStyle.type',
    choices: [{ value: 'solid', label: '실선' }, { value: 'dashed', label: '파선' }, { value: 'dotted', label: '점선' }],
  },
  {
    key: 'line.showSymbol', zone: 'type', section: '선', label: '점 표시',
    control: 'toggle', appliesTo: ['line'], default: true,
    echarts: 'series.showSymbol',
  },
  {
    key: 'line.symbolSize', zone: 'type', section: '선', label: '점 크기',
    control: 'slider', appliesTo: ['line'], default: 4,
    min: 2, max: 16, step: 1, unit: 'px',
    showIf: (o) => o.line?.showSymbol !== false,
    echarts: 'series.symbolSize',
  },
  {
    key: 'line.connectNulls', zone: 'type', section: '선', label: '결측값 연결',
    control: 'toggle', appliesTo: ['line'], default: false, tier: 'T2',
    echarts: 'series.connectNulls',
  },
  {
    key: 'line.areaOpacity', zone: 'type', section: '선', label: '영역 불투명도',
    control: 'slider', appliesTo: ['line'], default: 0.3, tier: 'T2',
    min: 0, max: 1, step: 0.1,
    showIf: (o) => o.variant === 'area' || o.variant === 'stackedArea',
    echarts: 'series.areaStyle.opacity',
  },

  // ── 혼합 (combo) — 시리즈별 막대/선 (bar·line 공용) ──
  {
    key: 'seriesTypes', zone: 'type', section: '혼합', label: '시리즈 종류',
    control: 'seriesTypes', appliesTo: ['bar', 'line'], default: {},
    echarts: '@seriesTypes',
    help: '실행 후 시리즈별로 막대/선을 지정해 혼합 차트를 만든다(미지정=대분류 종류)',
  },

  // ── 원형 ──
  {
    key: 'pie.donutWidth', zone: 'type', section: '원형', label: '도넛 두께',
    control: 'slider', appliesTo: ['pie'], default: 40,
    min: 10, max: 90, step: 5, unit: '%',
    showIf: (o) => o.variant === 'donut',
    echarts: '@pie.radius', help: 'radius=[100-두께, 100]% 로 변환',
  },
  {
    key: 'pie.labelPosition', zone: 'type', section: '원형', label: '라벨 위치',
    control: 'segment', appliesTo: ['pie'], default: 'outside',
    showIf: (o) => o.dataLabel === true,
    echarts: 'series.label.position',
    choices: [{ value: 'outside', label: '바깥' }, { value: 'inside', label: '안쪽' }, { value: 'center', label: '중앙' }],
  },
  {
    key: 'pie.startAngle', zone: 'type', section: '원형', label: '시작 각도',
    control: 'slider', appliesTo: ['pie'], default: 90, tier: 'T2',
    min: 0, max: 360, step: 15, unit: '°', echarts: 'series.startAngle',
  },
  {
    key: 'pie.minAngle', zone: 'type', section: '원형', label: '최소 표시 각',
    control: 'number', appliesTo: ['pie'], default: 0, tier: 'T2',
    min: 0, max: 45, echarts: 'series.minAngle',
    help: '작은 조각이 사라지지 않게 최소 각도 보장',
  },

  // ── 산점도 ──
  {
    key: 'scatter.symbol', zone: 'type', section: '산점도', label: '점 모양',
    control: 'select', appliesTo: ['scatter'], default: 'circle',
    echarts: 'series.symbol',
    choices: [
      { value: 'circle', label: '원' }, { value: 'rect', label: '사각' },
      { value: 'triangle', label: '삼각' }, { value: 'diamond', label: '마름모' },
    ],
  },
  {
    key: 'scatter.symbolSize', zone: 'type', section: '산점도', label: '점 크기',
    control: 'slider', appliesTo: ['scatter'], default: 10,
    min: 2, max: 40, step: 1, unit: 'px',
    showIf: (o) => o.variant !== 'bubble',
    echarts: 'series.symbolSize',
  },
  {
    key: 'scatter.bubbleField', zone: 'type', section: '산점도', label: '버블 크기 기준 컬럼',
    control: 'columnRef', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.variant === 'bubble',
    echarts: '@scatter.bubble', help: '실행 후 결과 컬럼에서 선택. symbolSize 를 값에 비례 인코딩',
  },

  // ── 지도 (map=코로플레스 · geoscatter=위경도 포인트 공용) ──
  {
    key: 'map.boundary.show', zone: 'type', section: '지도', label: '행정구역 표시',
    control: 'toggle', appliesTo: ['geoscatter'], default: true,
    echarts: 'geo.show',
    help: '끄면 배경 행정구역의 채움과 윤곽선을 숨기고 포인트만 표시합니다.',
  },
  {
    key: 'map.name', zone: 'type', section: '지도', label: '경계 수준',
    control: 'segment', appliesTo: ['map', 'geoscatter'], default: 'kr-sido',
    echarts: '@map.name',
    choices: [
      { value: 'kr-sido', label: '시·도' },
      { value: 'kr-sigungu', label: '시·군·구' },
    ],
    help: '데이터의 지역명 수준과 같은 내장 행정 경계를 선택합니다.',
  },
  {
    key: 'map.boundary.areaColor', zone: 'type', section: '지도', label: '채우기 색상',
    control: 'color', appliesTo: ['geoscatter'], default: null,
    showIf: (o) => o.map?.boundary?.show !== false,
    echarts: 'geo.itemStyle.areaColor',
    help: '자동은 현재 차트의 행정구역 채우기 색상을 사용합니다.',
  },
  {
    key: 'map.boundary.borderColor', zone: 'type', section: '지도', label: '윤곽선 색상',
    control: 'color', appliesTo: ['geoscatter'], default: null,
    showIf: (o) => o.map?.boundary?.show !== false,
    echarts: 'geo.itemStyle.borderColor',
    help: '자동은 현재 차트의 행정구역 윤곽선 색상을 사용합니다.',
  },
  {
    key: 'map.boundary.borderWidth', zone: 'type', section: '지도', label: '윤곽선 너비',
    control: 'slider', appliesTo: ['geoscatter'], default: 5,
    showIf: (o) => o.map?.boundary?.show !== false,
    min: 0, max: 20, step: 0.5, unit: 'px',
    echarts: 'geo.itemStyle.borderWidth',
    help: 'ChartSDK 기본값은 5px이며 최대 20px까지 지정할 수 있습니다.',
  },
  {
    key: 'map.viewport', zone: 'type', section: '지도', label: '표시 영역',
    control: 'mapViewport', appliesTo: ['map', 'geoscatter'], default: { mode: 'data' },
    echarts: '@map.viewport',
    help: '데이터 전체 자동 맞춤 또는 현재 Polygon 지역·지도 조정·WGS84 좌표로 초기 표시 영역을 저장',
  },
  {
    key: 'map.roam', zone: 'type', section: '지도', label: '확대·이동',
    control: 'toggle', appliesTo: ['map', 'geoscatter'], default: false,
    echarts: 'series.roam',
    help: '켜면 마우스 휠 확대·드래그 이동 허용',
  },
  {
    key: 'map.heatmapPointSize', zone: 'type', section: '히트맵', label: '점 반경',
    control: 'slider', appliesTo: ['map'], default: 20,
    min: 2, max: 80, step: 1, unit: 'px',
    showIf: (o) => o.variant === 'heatmap',
    echarts: 'series.pointSize',
    help: 'ECharts 6.1 geo heatmap의 pointSize입니다.',
  },
  {
    key: 'map.heatmapBlurSize', zone: 'type', section: '히트맵', label: '번짐 크기',
    control: 'slider', appliesTo: ['map'], default: 30,
    min: 0, max: 100, step: 1, unit: 'px',
    showIf: (o) => o.variant === 'heatmap',
    echarts: 'series.blurSize',
    help: 'ECharts 6.1 geo heatmap의 blurSize입니다.',
  },
  {
    key: 'map.heatmapMinOpacity', zone: 'type', section: '히트맵', label: '최소 불투명도',
    control: 'slider', appliesTo: ['map'], default: 0,
    min: 0, max: 1, step: 0.05,
    showIf: (o) => o.variant === 'heatmap',
    echarts: 'series.minOpacity',
  },
  {
    key: 'map.heatmapMaxOpacity', zone: 'type', section: '히트맵', label: '최대 불투명도',
    control: 'slider', appliesTo: ['map'], default: 1,
    min: 0, max: 1, step: 0.05,
    showIf: (o) => o.variant === 'heatmap',
    echarts: 'series.maxOpacity',
  },
  {
    key: 'geoscatter.symbol', zone: 'type', section: '점', label: '점 모양',
    control: 'select', appliesTo: ['geoscatter'], default: 'circle',
    echarts: 'series.symbol',
    choices: [
      { value: 'circle', label: '원' }, { value: 'rect', label: '사각' },
      { value: 'roundRect', label: '둥근 사각' }, { value: 'triangle', label: '삼각' },
      { value: 'diamond', label: '마름모' }, { value: 'pin', label: '핀' },
      { value: 'arrow', label: '화살표' },
    ],
  },
  {
    key: 'geoscatter.symbolSize', zone: 'type', section: '점', label: '점 크기',
    control: 'slider', appliesTo: ['geoscatter'], default: 10,
    min: 2, max: 40, step: 1, unit: 'px', echarts: 'series.symbolSize',
    help: '크기값 역할 컬럼을 선택하면 값에 비례한 크기로 대체됩니다.',
  },
  {
    key: 'geoscatter.opacity', zone: 'type', section: '점', label: '불투명도',
    control: 'slider', appliesTo: ['geoscatter'], default: 1,
    min: 0, max: 1, step: 0.05, echarts: 'series.itemStyle.opacity',
  },
  {
    key: 'geoscatter.borderColor', zone: 'type', section: '점', label: '테두리 색상',
    control: 'color', appliesTo: ['geoscatter'], default: '#FFFFFF',
    echarts: 'series.itemStyle.borderColor',
  },
  {
    key: 'geoscatter.borderWidth', zone: 'type', section: '점', label: '테두리 굵기',
    control: 'slider', appliesTo: ['geoscatter'], default: 0,
    min: 0, max: 10, step: 0.5, unit: 'px', echarts: 'series.itemStyle.borderWidth',
  },
  {
    key: 'geoscatter.showEffectOn', zone: 'type', section: '점', label: '효과 표시',
    control: 'segment', appliesTo: ['geoscatter'], default: 'render',
    showIf: (o) => o.variant === 'effectScatter',
    echarts: 'series.showEffectOn',
    choices: [{ value: 'render', label: '항상' }, { value: 'emphasis', label: '강조 시' }],
  },
  {
    key: 'geoscatter.rippleScale', zone: 'type', section: '점', label: '파동 크기',
    control: 'slider', appliesTo: ['geoscatter'], default: 2.5,
    min: 1, max: 10, step: 0.5,
    showIf: (o) => o.variant === 'effectScatter',
    echarts: 'series.rippleEffect.scale',
  },
  {
    key: 'geoscatter.ripplePeriod', zone: 'type', section: '점', label: '파동 주기',
    control: 'slider', appliesTo: ['geoscatter'], default: 4,
    min: 1, max: 20, step: 0.5, unit: '초',
    showIf: (o) => o.variant === 'effectScatter',
    echarts: 'series.rippleEffect.period',
  },
  {
    key: 'geoscatter.rippleBrushType', zone: 'type', section: '점', label: '파동 표현',
    control: 'segment', appliesTo: ['geoscatter'], default: 'fill',
    showIf: (o) => o.variant === 'effectScatter',
    echarts: 'series.rippleEffect.brushType',
    choices: [{ value: 'fill', label: '채움' }, { value: 'stroke', label: '윤곽' }],
  },
  // boxplot·heatmap 은 기본형 1개이며, 박스플롯 이상치는 공통 분석 표시 옵션으로 구성한다.
];

// ── 경로 유틸 (중첩 JSONB get/set) ────────────────────────────────

export function getPath(obj: Options, path: string): any {
  return path.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export function setPath(obj: Options, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

// ── 헬퍼: 패널·전환·기본값 ────────────────────────────────────────

/** 대분류의 중분류 선택지 */
export function getVariants(chartType: MajorType): VariantDef[] {
  return VARIANTS[chartType] ?? [];
}

/** def의 실효 기본값 (defaultByType 우선) */
export function defaultOf(def: OptionDef, chartType: MajorType): unknown {
  if (def.defaultByType && chartType in def.defaultByType) return def.defaultByType[chartType];
  return def.default;
}

/** 특정 대분류 + 현재 options에서 패널에 노출할 def 목록 (zone → section 순서 유지) */
export function visibleDefs(chartType: MajorType, options: Options): OptionDef[] {
  const visibilityOptions = options?.chartType === chartType
    ? options
    : { ...options, chartType };
  return OPTION_REGISTRY.filter(
    (d) => d.appliesTo.includes(chartType)
      && (d.key !== 'variant' || getVariants(chartType).length > 1)
      && (!d.showIf || d.showIf(visibilityOptions)),
  );
}

/**
 * `zone`은 차트 유형 전환 시 옵션을 유지·초기화하는 저장 계약이다.
 * 편집 화면의 정보 구조는 이 별도 메타데이터를 사용해 저장 계약과 UI 순서를 분리한다.
 */
export const OPTION_EDITOR_TAB_LABELS: Record<OptionEditorTab, string> = {
  basic: '기본',
  series: '계열',
  axis: '축',
  area: '영역',
  style: '스타일',
  interaction: '상호작용',
  data: '데이터',
};

/** 모든 차트가 공유하는 탭 상대 순서. 적용할 옵션이 없는 탭만 유형별로 생략한다. */
const OPTION_EDITOR_TAB_ORDER: OptionEditorTab[] = [
  'basic',
  'series',
  'axis',
  'area',
  'style',
  'interaction',
  'data',
];
const TOOLTIP_APPEARANCE_KEYS = new Set([
  'tooltip.backgroundColor',
  'tooltip.textColor',
  'tooltip.borderColor',
  'tooltip.borderWidth',
  'tooltip.padding',
  'typography.tooltipFontFamily',
  'typography.tooltipFontSize',
]);
const MAP_BOUNDARY_KEYS = new Set([
  'map.name',
  'map.boundary.show',
  'map.boundary.areaColor',
  'map.boundary.borderColor',
  'map.boundary.borderWidth',
]);
const MAP_VIEWPORT_KEYS = new Set(['map.viewport', 'map.roam']);
const MAP_AREA_KEYS = new Set([...MAP_BOUNDARY_KEYS, ...MAP_VIEWPORT_KEYS]);

/** 차트 대분류에 맞는 편집 탭을 사용자 작업 순서대로 반환한다. */
export function optionEditorTabsFor(chartType: MajorType): OptionEditorTab[] {
  const usesArea = chartType === 'map' || chartType === 'geoscatter';
  const usesAxis = chartType !== 'pie' && !usesArea;
  return OPTION_EDITOR_TAB_ORDER.filter(
    (tab) => (tab !== 'axis' || usesAxis) && (tab !== 'area' || usesArea),
  );
}

/** 레지스트리 옵션 하나가 편집 화면에서 속할 작업 탭. */
export function optionEditorTabOf(def: OptionDef): OptionEditorTab {
  if (MAP_AREA_KEYS.has(def.key)) return 'area';
  if (def.key === 'pie.labelPosition') return 'series';
  if (def.zone === 'axis') return 'axis';
  if (def.zone === 'type') return def.key === 'seriesTypes' ? 'series' : 'style';

  switch (def.section) {
    case '기본':
      return 'basic';
    case '색상':
      return 'style';
    case '범례':
    case '계열':
    case '분석 표시':
      return 'series';
    case '크기':
    case '글꼴':
      return 'style';
    case '툴팁':
    case '강조':
      return 'interaction';
    case '데이터 갱신':
      return 'data';
    default:
      throw new Error(`편집 탭이 지정되지 않은 옵션 섹션입니다: ${def.section} (${def.key})`);
  }
}

/** 저장 레지스트리의 섹션명을 편집 화면의 사용자 용어로 변환한다. */
export function optionEditorSectionOf(def: OptionDef): string {
  if (MAP_BOUNDARY_KEYS.has(def.key)) return '행정 경계';
  if (MAP_VIEWPORT_KEYS.has(def.key)) return '표시 영역';
  if (def.key === 'pie.labelPosition') return '라벨 · 정렬';
  if (TOOLTIP_APPEARANCE_KEYS.has(def.key)) return '툴팁 모양';
  if (def.section === '계열') return '라벨 · 정렬';
  return def.section;
}

const SERIES_SECTION_ORDER: Partial<Record<MajorType, string[]>> = {
  bar: ['혼합'],
  line: ['혼합'],
};

const STYLE_SECTION_ORDER: Partial<Record<MajorType, string[]>> = {
  bar: ['막대'],
  line: ['선'],
  pie: ['원형'],
  scatter: ['산점도'],
  map: ['히트맵'],
  geoscatter: ['점'],
};

/** 한 탭 안의 아코디언 섹션을 차트 편집 권장 순서대로 반환한다. */
export function optionEditorSectionOrder(chartType: MajorType, tab: OptionEditorTab): string[] {
  switch (tab) {
    case 'basic':
      return ['기본'];
    case 'area':
      return ['행정 경계', '표시 영역'];
    case 'series':
      return [...(SERIES_SECTION_ORDER[chartType] ?? []), '분석 표시', '라벨 · 정렬', '범례'];
    case 'axis':
      return ['축 글자', '여백', 'X축', 'Y축'];
    case 'style':
      return ['색상', ...(STYLE_SECTION_ORDER[chartType] ?? []), '크기', '글꼴'];
    case 'interaction':
      return ['툴팁', '툴팁 모양', '강조'];
    case 'data':
      return ['데이터 갱신'];
  }
}

/** 대분류의 전체 기본 options 객체 생성 (JSONB 저장 키만, 중첩 형태) */
export function defaultsFor(chartType: MajorType): Options {
  const o: Options = {};
  for (const def of OPTION_REGISTRY) {
    if (!def.appliesTo.includes(chartType)) continue;
    if ((def.storage ?? 'jsonb') !== 'jsonb') continue;
    const v = defaultOf(def, chartType);
    if (v !== undefined) setPath(o, def.key, v);
  }
  o.colorTheme = normalizeColorTheme(DEFAULT_COLOR_THEME, o.palettePreset, chartType);
  return o;
}

function mergeOptions(base: Options, override: Options): Options {
  const merged: Options = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (
      value != null
      && typeof value === 'object'
      && !Array.isArray(value)
      && merged[key] != null
      && typeof merged[key] === 'object'
      && !Array.isArray(merged[key])
    ) {
      merged[key] = mergeOptions(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

const TYPOGRAPHY_ELEMENT_SIZE_KEYS = [
  'titleFontSize',
  'legendFontSize',
  'axisFontSize',
  'dataLabelFontSize',
  'tooltipFontSize',
] as const;

const TYPOGRAPHY_ELEMENT_FAMILY_KEYS = [
  'titleFontFamily',
  'legendFontFamily',
  'axisFontFamily',
  'dataLabelFontFamily',
  'tooltipFontFamily',
] as const;

/**
 * 폐기된 typography.mode 일괄 게이트를 요소별 auto/px 계약으로 옮긴다.
 * 구 UX는 '자동'으로 되돌려도 직전 px 값을 남겨 두었으므로, mode='auto' 저장분의 잔존 px는
 * 사용자가 의도한 값이 아니다 — 지우고 자동으로 되돌린다. mode='custom'은 px를 그대로 살린다.
 */
function migrateLegacyTypographyMode(next: Options): void {
  if (!next.typography || typeof next.typography !== 'object' || Array.isArray(next.typography)) return;
  const typography = { ...next.typography };
  if (!('mode' in typography)) return;
  if (typography.mode !== 'custom') {
    for (const key of TYPOGRAPHY_ELEMENT_SIZE_KEYS) delete typography[key];
  }
  delete typography.mode;
  next.typography = typography;
}

function normalizeStoredFontFamily(value: unknown): string {
  return value === 'pretendard' || value === 'notoSansKr' ? value : 'default';
}

/** 전역 글꼴 저장본과 제거된 초기 선택값을 현재 3종 글꼴 계약으로 옮긴다. */
function migrateLegacyTypographyFontFamily(next: Options): void {
  if (!next.typography || typeof next.typography !== 'object' || Array.isArray(next.typography)) return;
  const typography = { ...next.typography };
  const hasLegacyGlobal = 'fontFamily' in typography;
  const legacyGlobal = hasLegacyGlobal ? normalizeStoredFontFamily(typography.fontFamily) : undefined;
  for (const key of TYPOGRAPHY_ELEMENT_FAMILY_KEYS) {
    if (key in typography) typography[key] = normalizeStoredFontFamily(typography[key]);
    else if (hasLegacyGlobal) typography[key] = legacyGlobal;
  }
  delete typography.fontFamily;
  next.typography = typography;
}

/**
 * 제거된 지도 계열별 스타일을 현재 계약으로 승격한다.
 * 색상은 계열별 colorMap으로 보존하고, 포인트 외형은 첫 저장 계열의 값을 공통 점 옵션으로 옮긴다.
 */
function migrateLegacyGeoSeriesStyles(next: Options, chartType: MajorType): void {
  if (!next.geoSeriesStyles || typeof next.geoSeriesStyles !== 'object' || Array.isArray(next.geoSeriesStyles)) return;
  const styles = next.geoSeriesStyles as Record<string, unknown>;
  const colorMap = next.colorMap && typeof next.colorMap === 'object' && !Array.isArray(next.colorMap)
    ? { ...next.colorMap }
    : {};
  const point = next.geoscatter && typeof next.geoscatter === 'object' && !Array.isArray(next.geoscatter)
    ? { ...next.geoscatter }
    : {};
  const pointKeys = [
    'opacity',
    'borderColor',
    'borderWidth',
    'symbol',
    'symbolSize',
    'showEffectOn',
    'rippleScale',
    'ripplePeriod',
    'rippleBrushType',
  ] as const;

  for (const [seriesName, rawStyle] of Object.entries(styles)) {
    if (!rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) continue;
    const style = rawStyle as Record<string, unknown>;
    if (colorMap[seriesName] == null && typeof style.color === 'string' && style.color.trim() !== '') {
      colorMap[seriesName] = style.color;
    }
    if (chartType === 'geoscatter') {
      for (const key of pointKeys) {
        if (!(key in point) && style[key] != null) point[key] = style[key];
      }
    }
  }

  if (Object.keys(colorMap).length > 0) next.colorMap = colorMap;
  if (chartType === 'geoscatter' && Object.keys(point).length > 0) next.geoscatter = point;
  delete next.geoSeriesStyles;
}

/**
 * 지도 전용이던 상호작용 설정을 공통 계약으로 승격한다.
 * 서버에도 같은 규칙이 있어, 편집기를 거치지 않는 구 저장 데이터도 호환된다.
 */
export function migrateLegacyInteractionOptions(options: Options, chartType: MajorType): Options {
  const next: Options = structuredClone(options ?? {});
  if (chartType === 'map' && (next.variant == null || next.variant === 'basic')) next.variant = 'map';
  if (chartType === 'geoscatter' && (next.variant == null || next.variant === 'basic')) next.variant = 'scatter';
  migrateLegacyTypographyMode(next);
  migrateLegacyTypographyFontFamily(next);
  migrateLegacyGeoSeriesStyles(next, chartType);
  if (next.tooltip && typeof next.tooltip === 'object' && !Array.isArray(next.tooltip)) {
    const tooltip = { ...next.tooltip };
    if (tooltip.trigger === 'auto') tooltip.trigger = 'item';
    delete tooltip.contentMode;
    delete tooltip.template;
    next.tooltip = tooltip;
  }
  const isCartesian = ['bar', 'line', 'scatter', 'boxplot', 'heatmap'].includes(chartType);
  if (isCartesian) {
    const metadata = next._chartsdk && typeof next._chartsdk === 'object' ? { ...next._chartsdk } : {};
    const usesLegacyAxisTitleLayout = metadata.axisTitleLayout !== 2;

    for (const axisKey of ['xAxis', 'yAxis'] as const) {
      if (!next[axisKey] || typeof next[axisKey] !== 'object') continue;
      const axis = { ...next[axisKey] };
      delete axis.offset;
      if (axisKey === 'xAxis') delete axis.hideOverlap;
      if (axisKey === 'yAxis') {
        delete axis.minInterval;
        delete axis.maxInterval;
      }
      if (axisKey === 'yAxis' && usesLegacyAxisTitleLayout && axis.titleRotate === 90) {
        axis.titleRotate = -90;
      }
      next[axisKey] = axis;
    }

    metadata.axisTitleLayout = 2;
    next._chartsdk = metadata;
  }
  if (chartType !== 'map' && chartType !== 'geoscatter') return next;

  const mapOptions = next.map && typeof next.map === 'object' ? { ...next.map } : {};
  const legacyTooltip = mapOptions.tooltip && typeof mapOptions.tooltip === 'object' ? mapOptions.tooltip : {};
  const legacyEmphasis = mapOptions.emphasis && typeof mapOptions.emphasis === 'object' ? mapOptions.emphasis : {};
  const tooltip = next.tooltip && typeof next.tooltip === 'object' ? { ...next.tooltip } : {};
  const emphasis = next.emphasis && typeof next.emphasis === 'object' ? { ...next.emphasis } : {};

  if (!('enabled' in tooltip) && 'enabled' in legacyTooltip) tooltip.enabled = legacyTooltip.enabled;
  delete tooltip.contentMode;
  delete tooltip.template;
  if (!('enabled' in emphasis) && 'enabled' in legacyEmphasis) emphasis.enabled = legacyEmphasis.enabled;
  if (!('color' in emphasis) && 'color' in legacyEmphasis) {
    emphasis.colorMode = 'custom';
    emphasis.color = legacyEmphasis.color;
  }

  delete mapOptions.tooltip;
  delete mapOptions.emphasis;
  next.map = mapOptions;
  if (Object.keys(tooltip).length > 0) next.tooltip = tooltip;
  if (Object.keys(emphasis).length > 0) next.emphasis = emphasis;
  return next;
}

/** 차트별 기본값과 저장 옵션을 중첩 객체까지 병합하고 레거시 상호작용 키를 정규화한다. */
export function optionsWithDefaults(chartType: MajorType, options: Options = {}): Options {
  const normalized = migrateLegacyInteractionOptions(options, chartType);
  const next = mergeOptions(defaultsFor(chartType), normalized);
  const hasStoredOptions = Object.keys(options ?? {}).length > 0;
  const usesLegacyColorTheme = hasStoredOptions && normalized.colorTheme?.version !== 4;
  if (!usesLegacyColorTheme) return next;

  // 모든 구 저장 데이터는 현재 차트군의 ColorBrewer 기본 팔레트로 일괄 전환한다.
  const defaultPreset = defaultPalettePresetForChartType(chartType);
  next.colorTheme = normalizeColorTheme(DEFAULT_COLOR_THEME, defaultPreset, chartType);
  next.palettePreset = defaultPreset;
  next.palette = colorBrewerPalette(defaultPreset);
  next.paletteReversed = false;
  next.paletteActiveIndex = 0;
  next.autoColorMap = {};
  next.colorMap = {};
  next.itemColorOverrides = [];
  return next;
}

/** zone='type' (대분류 전용) JSONB 키 목록 — 대분류 전환 시 초기화 대상 */
export function typeZoneKeys(): string[] {
  return OPTION_REGISTRY
    .filter((d) => d.zone === 'type' && (d.storage ?? 'jsonb') === 'jsonb')
    .map((d) => d.key);
}

/**
 * 대분류 전환 시 options 재구성.
 *   - common  : 유지
 *   - axis    : 직교끼리 유지 / 원형 관련 전환은 호출측에서 숨김+보존 처리
 *   - type    : 삭제 후 새 대분류 전용 기본값 주입
 * 반환: { next, removedKeys }  (removedKeys → 토스트·실행취소용)
 */
export function switchMajor(prev: Options, from: MajorType, to: MajorType): { next: Options; removedKeys: string[] } {
  const next: Options = structuredClone(prev);
  const removedKeys: string[] = [];

  // 1) 이전 대분류 전용(type) 키 제거
  for (const def of OPTION_REGISTRY) {
    if (def.zone !== 'type' || (def.storage ?? 'jsonb') !== 'jsonb') continue;
    if (def.appliesTo.includes(from) && getPath(next, def.key) !== undefined) {
      removedKeys.push(def.key);
      setPath(next, def.key, undefined);
    }
  }

  // 2) 새 대분류 전용 기본값 주입 + variant 기본값 교체
  for (const def of OPTION_REGISTRY) {
    if ((def.storage ?? 'jsonb') !== 'jsonb') continue;
    if (def.zone === 'type' && def.appliesTo.includes(to)) {
      const v = defaultOf(def, to);
      if (v !== undefined) setPath(next, def.key, v);
    }
  }
  next.variant = defaultOf(OPTION_REGISTRY.find((d) => d.key === 'variant')!, to);

  return { next: switchPaletteForChartType(next, from, to), removedKeys };
}
