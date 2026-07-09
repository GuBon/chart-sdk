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
 *       axis   : 직교 차트(막대·선·분포) → 직교끼리 유지, 원형 전환 시 숨김+보존
 *       type   : 대분류 전용            → 대분류 전환 시 초기화(+토스트·실행취소)
 *   - tier  : 구현 시급도 (언제 만드는가) → T1 = MVP 기본 품질, T2 = 자주, T3 = 고급
 *
 * 관련 문서: PRD v1.6 (7.2 전환규칙 · 9.2 options 키) / 화면설계서 v2.4 (4.4 옵션 패널)
 * 대상 라이브러리: Apache ECharts v6
 */

// ── 기본 타입 ─────────────────────────────────────────────────────

export type MajorType = 'bar' | 'line' | 'pie' | 'scatter';
export type Zone = 'common' | 'axis' | 'type';
export type Tier = 'T1' | 'T2' | 'T3';

/** 활성 대분류 런타임 목록 (MajorType 의 단일 진실원 — 패널 그리드·기본값 생성·전환이 공유) */
export const MAJOR_TYPES: MajorType[] = ['bar', 'line', 'pie', 'scatter'];

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
  /** select/segment 선택지 */
  choices?: { value: string | number; label: string }[];
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
};

// ── 공통 선택지 상수 ──────────────────────────────────────────────

const FORMAT_CHOICES = [
  { value: 'raw',      label: '원본' },
  { value: 'comma',    label: '천단위 (1,000)' },
  { value: 'decimal0', label: '정수 반올림' },
  { value: 'decimal1', label: '소수 1자리' },
  { value: 'percent',  label: '백분율 (%)' },
];

const TTL_CHOICES = [
  { value: 900,   label: '15분' },
  { value: 3600,  label: '1시간' },
  { value: 21600, label: '6시간' },
  { value: 86400, label: '24시간' },
];

// ── 레지스트리 본체 ───────────────────────────────────────────────

export const OPTION_REGISTRY: OptionDef[] = [
  // ════════════════════════════ ZONE 1 · 공통 ════════════════════════════

  // ── 기본 ──
  {
    key: 'chartType', zone: 'common', section: '기본', label: '대분류',
    control: 'iconGrid', appliesTo: ['bar', 'line', 'pie', 'scatter'],
    storage: 'column', column: 'chart_type', default: 'bar', echarts: '@series.type',
    choices: [
      { value: 'bar', label: '막대' }, { value: 'line', label: '선' },
      { value: 'pie', label: '원형' }, { value: 'scatter', label: '분포' },
    ],
    help: 'MVP 4종 활성. 원형·분포 이후 추가 차트는 잠금("후속") 표기',
  },
  {
    key: 'variant', zone: 'common', section: '기본', label: '중분류',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'],
    defaultByType: { bar: 'basic', line: 'basic', pie: 'pie', scatter: 'scatter' },
    echarts: '@variant',
    help: '선택지는 VARIANTS[chartType] 에서 동적으로 채운다 (대분류 종속)',
  },
  {
    key: 'title', zone: 'common', section: '기본', label: '차트 제목',
    control: 'text', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: '',
    echarts: 'title.text',
  },
  {
    key: 'titleH', zone: 'common', section: '기본', label: '제목 가로 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'center',
    echarts: 'title.left',
    choices: [{ value: 'left', label: '좌' }, { value: 'center', label: '중앙' }, { value: 'right', label: '우' }],
  },
  {
    key: 'titleV', zone: 'common', section: '기본', label: '제목 세로 위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'top',
    echarts: 'title.top',
    choices: [{ value: 'top', label: '상' }, { value: 'bottom', label: '하' }],
  },
  {
    key: 'description', zone: 'common', section: '기본', label: '설명',
    control: 'textarea', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: '',
    storage: 'column', column: 'description', echarts: '@none',
    help: 'S1 카드 표시·검색용. option 미반영 (차트 메타)',
  },

  // ── 색상 ──
  {
    key: 'colorMode', zone: 'common', section: '색상', label: '색 모드',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'palette',
    echarts: '@color',
    choices: [{ value: 'palette', label: '팔레트' }, { value: 'individual', label: '개별' }],
  },
  {
    key: 'palette', zone: 'common', section: '색상', label: '팔레트 프리셋',
    control: 'palette', appliesTo: ['bar', 'line', 'pie', 'scatter'],
    default: ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'],
    echarts: 'color',
  },
  {
    key: 'colorMap', zone: 'common', section: '색상', label: '개별 색 지정',
    control: 'colorMap', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: {},
    showIf: (o) => o.colorMode === 'individual',
    echarts: '@colorMap',
    help: '실행 성공 후 활성(동적). 막대=항목/시리즈, 선=시리즈, 원형=조각. colorMap에 없으면 팔레트 순서 자동',
  },

  // ── 범례 ──
  {
    key: 'legend.show', zone: 'common', section: '범례', label: '범례 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: true,
    echarts: 'legend.show',
  },
  {
    key: 'legend.position', zone: 'common', section: '범례', label: '위치',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'bottom',
    showIf: (o) => o.legend?.show !== false,
    echarts: '@legend.position',
    choices: [
      { value: 'top', label: '상' }, { value: 'bottom', label: '하' },
      { value: 'left', label: '좌' }, { value: 'right', label: '우' },
    ],
    help: '좌/우 선택 시 변환기가 legend.orient=vertical 로 자동 설정',
  },
  {
    key: 'legend.scroll', zone: 'common', section: '범례', label: '많을 때 스크롤',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: false, tier: 'T2',
    showIf: (o) => o.legend?.show !== false,
    echarts: '@legend.type',
    help: 'true → legend.type=scroll (항목 많을 때 페이지네이션)',
  },

  // ── 툴팁 ──
  {
    key: 'tooltip.trigger', zone: 'common', section: '툴팁', label: '트리거',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'],
    defaultByType: { bar: 'axis', line: 'axis', pie: 'item', scatter: 'item' },
    echarts: 'tooltip.trigger',
    choices: [{ value: 'item', label: '항목' }, { value: 'axis', label: '축' }],
  },
  {
    key: 'tooltip.valueFormat', zone: 'common', section: '툴팁', label: '값 포맷',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'raw',
    echarts: '@tooltip.valueFormatter', choices: FORMAT_CHOICES,
  },
  {
    key: 'tooltip.axisPointer', zone: 'common', section: '툴팁', label: '축 지시선',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter'], default: 'line',
    showIf: (o) => o.tooltip?.trigger === 'axis',
    echarts: 'tooltip.axisPointer.type',
    choices: [{ value: 'line', label: '선' }, { value: 'shadow', label: '음영' }, { value: 'cross', label: '십자' }],
  },

  // ── 계열 ──
  {
    key: 'dataLabel', zone: 'common', section: '계열', label: '데이터 라벨 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: false,
    echarts: 'series.label.show',
  },
  {
    key: 'labelPosition', zone: 'common', section: '계열', label: '라벨 위치',
    control: 'select', appliesTo: ['bar', 'line', 'pie'], tier: 'T2',
    defaultByType: { bar: 'top', line: 'top', pie: 'outside' },
    showIf: (o) => o.dataLabel === true,
    echarts: 'series.label.position',
    choices: [
      { value: 'top', label: '위' }, { value: 'inside', label: '안쪽' },
      { value: 'outside', label: '바깥(원형)' },
    ],
  },
  {
    key: 'sortOrder', zone: 'common', section: '계열', label: '정렬',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'none',
    echarts: '@sort',
    choices: [{ value: 'none', label: '원본' }, { value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }],
    help: '서버에서 rows 정렬 (ECharts 옵션 아님)',
  },

  // ── 데이터 갱신 ──
  {
    key: 'refreshMode', zone: 'common', section: '데이터 갱신', label: '갱신 모드',
    control: 'segment', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 'ttl',
    storage: 'column', column: 'refresh_mode', echarts: '@none',
    choices: [{ value: 'live', label: '실시간' }, { value: 'ttl', label: '주기' }, { value: 'manual', label: '수동' }],
    help: 'PRD 7.7 결과 캐싱',
  },
  {
    key: 'cacheTtlSeconds', zone: 'common', section: '데이터 갱신', label: '주기',
    control: 'select', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: 3600,
    storage: 'column', column: 'cache_ttl_seconds', echarts: '@none',
    showIf: (o) => o.refreshMode === 'ttl', choices: TTL_CHOICES,
  },
  {
    key: 'refreshNow', zone: 'common', section: '데이터 갱신', label: '지금 갱신',
    control: 'button', appliesTo: ['bar', 'line', 'pie', 'scatter'], tier: 'T2',
    storage: 'none', echarts: '@none',
    help: 'POST /charts/{id}/refresh (2차). "마지막 계산 {시각}" 표시',
  },
  {
    key: 'showComputedAt', zone: 'common', section: '데이터 갱신', label: '데이터 기준 시각 표시',
    control: 'toggle', appliesTo: ['bar', 'line', 'pie', 'scatter'], default: true,
    showIf: (o) => o.refreshMode !== 'live',
    echarts: '@none',
    help: 'S4 "데이터 기준 {시각}" 캡션 (캐시 모드일 때만)',
  },

  // ════════════════════════════ ZONE 2 · 좌표/축 ════════════════════════════
  // 직교 차트(막대·선·분포)만. 원형 전환 시 숨김+보존(복귀 시 복원).

  // ── 여백 ──
  {
    key: 'grid.containLabel', zone: 'axis', section: '여백', label: '라벨 잘림 방지',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter'], default: true,
    echarts: 'grid.containLabel',
    help: 'T1 — 긴 축 라벨이 플롯 밖으로 잘리는 것 방지',
  },
  {
    key: 'grid.preset', zone: 'axis', section: '여백', label: '여백 프리셋',
    control: 'select', appliesTo: ['bar', 'line', 'scatter'], default: 'normal',
    echarts: '@grid.preset',
    choices: [{ value: 'compact', label: '좁게' }, { value: 'normal', label: '보통' }, { value: 'loose', label: '넓게' }],
  },

  // ── X축 ──
  {
    key: 'xAxis.title', zone: 'axis', section: 'X축', label: '제목',
    control: 'text', appliesTo: ['bar', 'line', 'scatter'], default: '',
    echarts: 'xAxis.name',
  },
  {
    key: 'xAxis.rotate', zone: 'axis', section: 'X축', label: '라벨 회전',
    control: 'slider', appliesTo: ['bar', 'line', 'scatter'], default: 0,
    min: 0, max: 90, step: 5, unit: '°', echarts: 'xAxis.axisLabel.rotate',
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
    help: '숫자 X축(분포)에서만 유효. 카테고리 X축에선 무시',
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
    control: 'text', appliesTo: ['bar', 'line', 'scatter'], default: '',
    echarts: 'yAxis.name',
  },
  {
    key: 'yAxis.unit', zone: 'axis', section: 'Y축', label: '단위 표기',
    control: 'text', appliesTo: ['bar', 'line', 'scatter'], default: '',
    echarts: '@yAxis.unit', help: '예: 원, %, 건. format과 결합되어 axisLabel.formatter 생성',
  },
  {
    key: 'yAxis.format', zone: 'axis', section: 'Y축', label: '라벨 포맷',
    control: 'select', appliesTo: ['bar', 'line', 'scatter'], default: 'raw',
    echarts: '@yAxis.formatter', choices: FORMAT_CHOICES,
    help: 'T1 — 천단위 콤마/소수점. unit과 합쳐 최종 포맷터 구성',
  },
  {
    key: 'yAxis.rangeMode', zone: 'axis', section: 'Y축', label: '범위',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter'], default: 'auto',
    echarts: '@yAxis.range',
    choices: [{ value: 'auto', label: '자동' }, { value: 'manual', label: '수동' }],
  },
  {
    key: 'yAxis.min', zone: 'axis', section: 'Y축', label: '최솟값',
    control: 'number', appliesTo: ['bar', 'line', 'scatter'], default: null,
    showIf: (o) => o.yAxis?.rangeMode === 'manual', echarts: 'yAxis.min',
  },
  {
    key: 'yAxis.max', zone: 'axis', section: 'Y축', label: '최댓값',
    control: 'number', appliesTo: ['bar', 'line', 'scatter'], default: null,
    showIf: (o) => o.yAxis?.rangeMode === 'manual', echarts: 'yAxis.max',
  },
  {
    key: 'yAxis.scale', zone: 'axis', section: 'Y축', label: '스케일',
    control: 'segment', appliesTo: ['bar', 'line', 'scatter'], default: 'value',
    echarts: '@yAxis.type',
    choices: [{ value: 'value', label: '선형' }, { value: 'log', label: '로그' }],
  },
  {
    key: 'yAxis.splitLine', zone: 'axis', section: 'Y축', label: '가로 격자선',
    control: 'toggle', appliesTo: ['bar', 'line', 'scatter'], default: true,
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
    key: 'line.areaOpacity', zone: 'type', section: '선', label: '영역 투명도',
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

  // ── 분포 ──
  {
    key: 'scatter.symbol', zone: 'type', section: '분포', label: '점 모양',
    control: 'select', appliesTo: ['scatter'], default: 'circle',
    echarts: 'series.symbol',
    choices: [
      { value: 'circle', label: '원' }, { value: 'rect', label: '사각' },
      { value: 'triangle', label: '삼각' }, { value: 'diamond', label: '마름모' },
    ],
  },
  {
    key: 'scatter.symbolSize', zone: 'type', section: '분포', label: '점 크기',
    control: 'slider', appliesTo: ['scatter'], default: 10,
    min: 2, max: 40, step: 1, unit: 'px',
    showIf: (o) => o.variant !== 'bubble',
    echarts: 'series.symbolSize',
  },
  {
    key: 'scatter.bubbleField', zone: 'type', section: '분포', label: '버블 크기 기준 컬럼',
    control: 'columnRef', appliesTo: ['scatter'], default: null,
    showIf: (o) => o.variant === 'bubble',
    echarts: '@scatter.bubble', help: '실행 후 결과 컬럼에서 선택. symbolSize 를 값에 비례 인코딩',
  },
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
  return OPTION_REGISTRY.filter(
    (d) => d.appliesTo.includes(chartType) && (!d.showIf || d.showIf(options)),
  );
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
  return o;
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

  return { next, removedKeys };
}
