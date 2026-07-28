export const MAX_ANALYSIS_ANNOTATIONS_PER_KIND = 12;

export type AnalysisLineType = 'solid' | 'dashed' | 'dotted';
export type AnalysisTargetSymbol = 'pin' | 'diamond' | 'circle';

interface AnalysisAnnotationBase {
  id: string;
  name: string;
  /** 결과의 값 계열 인덱스(0부터). 해당 계열의 Y축에 분석 표시를 연결한다. */
  seriesIndex: number;
  color: string;
  showLabel: boolean;
}

export interface AnalysisReferenceLine extends AnalysisAnnotationBase {
  value: number | null;
  lineType: AnalysisLineType;
  lineWidth: number;
}

export interface AnalysisReferenceRange extends AnalysisAnnotationBase {
  min: number | null;
  max: number | null;
  opacity: number;
}

export interface AnalysisTarget extends AnalysisAnnotationBase {
  /** 범주형 차트는 X 범주, 산점도는 숫자 X 좌표. */
  xValue: unknown;
  value: number | null;
  symbol: AnalysisTargetSymbol;
  symbolSize: number;
}

export interface AnalysisAnnotations {
  lines: AnalysisReferenceLine[];
  ranges: AnalysisReferenceRange[];
  targets: AnalysisTarget[];
}

export const EMPTY_ANALYSIS_ANNOTATIONS: AnalysisAnnotations = {
  lines: [],
  ranges: [],
  targets: [],
};

/**
 * 저장 JSON은 외부 API에서도 들어올 수 있으므로 UI가 배열 연산을 하기 전에 구조만 안전하게 정규화한다.
 * 숫자·색상 범위의 최종 검증은 서버와 MSW 변환기가 동일하게 수행한다.
 */
export function analysisAnnotationsOf(value: unknown): AnalysisAnnotations {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    lines: objectItems(source.lines) as unknown as AnalysisReferenceLine[],
    ranges: objectItems(source.ranges) as unknown as AnalysisReferenceRange[],
    targets: objectItems(source.targets) as unknown as AnalysisTarget[],
  };
}

function objectItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object' && !Array.isArray(item))
    .slice(0, MAX_ANALYSIS_ANNOTATIONS_PER_KIND);
}
