import { describe, expect, it } from 'vitest';
import { isRelationSelectable, relationBadgeLabel, relationTypeLabel } from './relations';

describe('relation presentation metadata', () => {
  it('관계 종류를 제품 표기 규칙으로 변환한다', () => {
    expect(relationTypeLabel('TABLE')).toBe('TABLE');
    expect(relationTypeLabel('VIEW')).toBe('View');
    expect(relationTypeLabel('MATERIALIZED_VIEW')).toBe('Materialized View');
  });

  it('갱신되지 않은 Materialized View만 선택을 막는다', () => {
    expect(isRelationSelectable({ relationType: 'TABLE' })).toBe(true);
    expect(isRelationSelectable({ relationType: 'VIEW' })).toBe(true);
    expect(isRelationSelectable({ relationType: 'MATERIALIZED_VIEW', populated: true })).toBe(true);
    expect(isRelationSelectable({ relationType: 'MATERIALIZED_VIEW', populated: false })).toBe(false);
  });

  it('선택 불가능한 관계의 갱신 상태를 배지에 포함한다', () => {
    expect(relationBadgeLabel({ relationType: 'MATERIALIZED_VIEW', populated: false }))
      .toBe('Materialized View · 갱신 필요');
  });
});
