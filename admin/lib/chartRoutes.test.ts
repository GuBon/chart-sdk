import { describe, expect, it } from 'vitest';
import { chartEditPath } from './chartRoutes';

describe('chartEditPath', () => {
  it('메인 테이블의 데이터소스·스키마·이름과 차트 번호로 정식 편집 주소를 만든다', () => {
    expect(chartEditPath(12, { datasourceId: 2, schema: 'analytics', name: '월 매출' }))
      .toBe('/tables/2/analytics/%EC%9B%94%20%EB%A7%A4%EC%B6%9C/charts/12');
  });

  it('메인 테이블을 모르는 레거시 차트는 기존 주소를 유지한다', () => {
    expect(chartEditPath(12)).toBe('/charts/12');
  });
});

