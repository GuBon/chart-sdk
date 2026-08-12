import { describe, expect, it } from 'vitest';
import { chartSaveIssue, type ChartSaveReadiness } from './chartSave';

const ready: ChartSaveReadiness = {
  name: '지역별 인구',
  builderIssue: null,
  hasDatasource: true,
  hasResult: true,
  resultKind: 'chart',
  running: false,
  runError: null,
};

describe('chartSaveIssue', () => {
  it('저장 가능한 상태에는 안내를 반환하지 않는다', () => {
    expect(chartSaveIssue(ready)).toBeNull();
  });

  it.each([
    [{ name: ' ' }, '차트 이름을 입력해야 저장할 수 있습니다.'],
    [{ builderIssue: '차트 종류를 선택하세요.' }, '차트 종류를 선택해야 저장할 수 있습니다.'],
    [{ builderIssue: '테이블을 선택하세요.' }, '테이블을 선택해야 저장할 수 있습니다.'],
    [{ builderIssue: 'X축 컬럼을 선택하세요.' }, 'X축 컬럼을 선택해야 저장할 수 있습니다.'],
    [{ builderIssue: 'Y축을 1개 이상 추가하세요.' }, 'Y축을 1개 이상 추가해야 저장할 수 있습니다.'],
    [{ running: true }, '차트 실행이 끝난 후 저장할 수 있습니다.'],
    [{ hasResult: false, resultKind: null }, '현재 차트 구성을 먼저 실행해야 저장할 수 있습니다.'],
    [
      { hasResult: false, resultKind: null, runError: '실행 실패' },
      '가장 최근 실행이 실패했습니다. 실행 오류를 해결한 후 다시 실행해야 저장할 수 있습니다.',
    ],
    [
      { resultKind: 'table' },
      '현재 실행 결과는 테이블 조회 결과입니다. X축과 Y축을 설정한 후 실행해야 저장할 수 있습니다.',
    ],
  ] as Array<[Partial<ChartSaveReadiness>, string]>)('$1 상태를 안내한다', (override, message) => {
    expect(chartSaveIssue({ ...ready, ...override })).toBe(message);
  });

  it('세부 빌더 오류도 숨기지 않는다', () => {
    expect(chartSaveIssue({ ...ready, builderIssue: '원형 차트는 Y축을 1개만 사용할 수 있습니다.' }))
      .toBe('차트 구성을 수정해야 저장할 수 있습니다. 원형 차트는 Y축을 1개만 사용할 수 있습니다.');
  });
});
