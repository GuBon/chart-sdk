export interface ChartSaveReadiness {
  name: string;
  builderIssue: string | null;
  hasDatasource: boolean;
  hasResult: boolean;
  resultKind: 'chart' | 'table' | null;
  running: boolean;
  runError: string | null;
}

const BUILDER_SAVE_MESSAGES: Record<string, string> = {
  '테이블을 선택하세요.': '테이블을 선택해야 저장할 수 있습니다.',
  'X축 컬럼을 선택하세요.': 'X축 컬럼을 선택해야 저장할 수 있습니다.',
  'Y축을 1개 이상 추가하세요.': 'Y축을 1개 이상 추가해야 저장할 수 있습니다.',
};

/** 저장 버튼을 눌렀을 때 사용자에게 보여줄 가장 우선순위가 높은 미충족 조건. */
export function chartSaveIssue({
  name,
  builderIssue,
  hasDatasource,
  hasResult,
  resultKind,
  running,
  runError,
}: ChartSaveReadiness): string | null {
  if (!name.trim()) return '차트 이름을 입력해야 저장할 수 있습니다.';
  if (builderIssue) {
    return BUILDER_SAVE_MESSAGES[builderIssue]
      ?? `차트 구성을 수정해야 저장할 수 있습니다. ${builderIssue}`;
  }
  if (!hasDatasource) return '데이터소스와 테이블을 선택해야 저장할 수 있습니다.';
  if (running) return '차트 실행이 끝난 후 저장할 수 있습니다.';
  if (!hasResult) {
    return runError
      ? '가장 최근 실행이 실패했습니다. 실행 오류를 해결한 후 다시 실행해야 저장할 수 있습니다.'
      : '현재 차트 구성을 먼저 실행해야 저장할 수 있습니다.';
  }
  if (resultKind !== 'chart') {
    return '현재 실행 결과는 테이블 조회 결과입니다. X축과 Y축을 설정한 후 실행해야 저장할 수 있습니다.';
  }
  return null;
}
