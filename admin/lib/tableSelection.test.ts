import { describe, expect, it } from 'vitest';
import { tableSelectionLabel } from './tableSelection';

describe('table selection target labels', () => {
  it('기존 조인은 1부터 시작하는 순서로 표시한다', () => {
    expect(tableSelectionLabel({ kind: 'join', index: 1 }, 3)).toBe('2번째 조인 테이블 선택 중');
  });

  it('새 조인은 현재 조인 수 다음 순서로 표시한다', () => {
    expect(tableSelectionLabel({ kind: 'newJoin' }, 2)).toBe('3번째 조인 테이블 선택 중');
  });
});
