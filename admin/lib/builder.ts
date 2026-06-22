import type { AggType, BuilderConfig, WhereOp, XAxisBucket } from '@/lib/api';

// 노코드 빌더 UI 상수 — 생성규칙 3·3A·4장의 라벨.
export const AGG_CHOICES: { value: AggType; label: string }[] = [
  { value: 'sum', label: '합계 (SUM)' },
  { value: 'avg', label: '평균 (AVG)' },
  { value: 'count', label: '개수 (COUNT)' },
  { value: 'count_distinct', label: '고유 개수' },
  { value: 'min', label: '최소 (MIN)' },
  { value: 'max', label: '최대 (MAX)' },
];

export const OP_CHOICES: { value: WhereOp; label: string }[] = [
  { value: 'eq', label: '= 같음' },
  { value: 'neq', label: '≠ 같지 않음' },
  { value: 'gt', label: '> 초과' },
  { value: 'gte', label: '≥ 이상' },
  { value: 'lt', label: '< 미만' },
  { value: 'lte', label: '≤ 이하' },
  { value: 'contains', label: '포함' },
  { value: 'starts_with', label: '~로 시작' },
  { value: 'in', label: '목록 중 (,)' },
  { value: 'between', label: '사이 (a,b)' },
  { value: 'is_null', label: '비어 있음' },
  { value: 'is_not_null', label: '비어 있지 않음' },
];

export const BUCKET_CHOICES: { value: Exclude<XAxisBucket, null>; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
];

/** 값 입력이 필요 없는 연산자 (생성규칙 4장) */
export const VALUELESS_OPS: WhereOp[] = ['is_null', 'is_not_null'];

/** X축 묶기를 노출할 날짜 계열 타입 (생성규칙 3A) */
export function isDateType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('date') || t.includes('timestamp') || t.includes('time');
}

export function emptyBuilder(): BuilderConfig {
  return { table: null, xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null };
}

/** orderBy 대상 라벨 (x = X축, y{i} = i번째 시리즈 별칭) */
export function orderTargets(cfg: BuilderConfig): { value: string; label: string }[] {
  const targets = [{ value: 'x', label: cfg.xAxis ? `${cfg.xAxis} (X)` : 'X축' }];
  cfg.yAxis.forEach((y, i) => {
    targets.push({ value: `y${i}`, label: `${y.alias || `${y.agg}_${y.column}`} (Y${i + 1})` });
  });
  return targets;
}
