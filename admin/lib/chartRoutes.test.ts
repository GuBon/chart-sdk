import { describe, expect, it } from 'vitest';
import { chartDatasourcePath, chartEditPath, chartRelationPath, chartSchemaPath } from './chartRoutes';

describe('chartEditPath', () => {
  it('메인 테이블의 데이터소스·스키마·이름과 차트 번호로 정식 편집 주소를 만든다', () => {
    expect(chartEditPath(12, { datasourceId: 2, datasourceName: '영업 분석 DB', schema: 'analytics', name: '월 매출' }))
      .toBe('/charts/%EC%98%81%EC%97%85%20%EB%B6%84%EC%84%9D%20DB/analytics/%EC%9B%94%20%EB%A7%A4%EC%B6%9C/12');
  });

  it('데이터소스·스키마·관계별 차트 경로를 같은 계층으로 만든다', () => {
    expect(chartDatasourcePath('sales-db')).toBe('/charts/sales-db');
    expect(chartSchemaPath('영업 DB', '분석 스키마'))
      .toBe('/charts/%EC%98%81%EC%97%85%20DB/%EB%B6%84%EC%84%9D%20%EC%8A%A4%ED%82%A4%EB%A7%88');
    expect(chartRelationPath({ datasourceName: 'sales-db', schema: 'public', name: '월 매출' }))
      .toBe('/charts/sales-db/public/%EC%9B%94%20%EB%A7%A4%EC%B6%9C');
  });
});
