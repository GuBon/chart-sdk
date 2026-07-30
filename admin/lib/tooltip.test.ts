import { describe, expect, it } from 'vitest';
import {
  tooltipFieldVisible,
  tooltipFieldsFor,
  updateTooltipFieldVisibility,
  visibleTooltipFields,
} from '@chartsdk/chart-options/tooltip';

describe('툴팁 필드 카탈로그', () => {
  it('빌더의 실제 연결 필드와 측정값 별칭을 사용자 레이블로 사용한다', () => {
    const fields = tooltipFieldsFor({
      chartType: 'bar',
      columns: [
        { name: 'region', type: 'text' },
        { name: '월 매출', type: 'numeric' },
      ],
      options: {},
      builderConfig: {
        xAxis: 'sales.region',
        yAxis: [{ column: 'sales.amount', agg: 'sum', alias: '월 매출' }],
      },
    });

    expect(fields).toEqual([
      {
        key: 'x:sales.region',
        label: 'region',
        role: '가로축',
        kind: 'category',
        defaultVisible: true,
      },
      {
        key: 'measure:sum:sales.amount:0',
        label: '월 매출',
        role: '합계',
        kind: 'measure',
        defaultVisible: true,
        seriesName: '월 매출',
        valueIndex: 1,
      },
    ]);
  });

  it('지도는 연결된 업무 필드명을 표시하고 좌표는 선택 가능한 기본 OFF 항목으로 둔다', () => {
    const fields = tooltipFieldsFor({
      chartType: 'geoscatter',
      columns: [
        { name: '__chartsdk_longitude', type: 'number' },
        { name: '__chartsdk_latitude', type: 'number' },
        { name: '__chartsdk_point_name', type: 'text' },
        { name: '__chartsdk_point_value', type: 'number' },
        { name: '__chartsdk_size', type: 'number' },
      ],
      options: { variant: 'scatter' },
      builderConfig: {
        xAxis: 'stores.longitude',
        yAxis: [
          { column: 'stores.latitude', agg: 'none' },
          { column: 'stores.visitors', agg: 'sum' },
        ],
        geoPoint: {
          mode: 'columns',
          nameColumn: 'stores.name',
          valueColumn: 'stores.sales',
          sizeColumn: 'stores.visitors',
        },
      },
    });

    expect(fields.map(({ label, role, defaultVisible }) => ({ label, role, defaultVisible }))).toEqual([
      { label: 'name', role: '포인트 이름', defaultVisible: true },
      { label: 'sales', role: '값', defaultVisible: true },
      { label: 'visitors', role: '포인트 크기', defaultVisible: true },
      { label: 'longitude', role: '위치', defaultVisible: false },
      { label: 'latitude', role: '위치', defaultVisible: false },
    ]);
  });

  it('기본값과 다른 ON/OFF만 저장해 새 필드는 자동 표시하고 사라진 필드는 무시한다', () => {
    const [category, value] = tooltipFieldsFor({
      chartType: 'pie',
      columns: [
        { name: 'product', type: 'text' },
        { name: 'revenue', type: 'number' },
      ],
      builderConfig: {
        xAxis: 'product',
        yAxis: [{ column: 'revenue', agg: 'sum' }],
      },
    });

    const hiddenCategory = updateTooltipFieldVisibility({}, category, false);
    expect(hiddenCategory).toEqual({ 'category:product': false });
    expect(tooltipFieldVisible(category, hiddenCategory)).toBe(false);
    expect(tooltipFieldVisible(value, hiddenCategory)).toBe(true);
    expect(visibleTooltipFields([category, value], {
      ...hiddenCategory,
      'measure:old_field:99': false,
    })).toEqual([value]);

    expect(updateTooltipFieldVisibility(hiddenCategory, category, true)).toEqual({});
  });
});
