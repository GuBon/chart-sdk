import { describe, expect, it } from 'vitest';
import {
  colorSelectionFromChartClick,
  cssColorToHex,
  itemTargetAt,
  locateColorSelection,
  staticColorSelections,
} from './chartColorSelection';

describe('chart color selection', () => {
  it('막대 클릭을 시리즈명과 카테고리로 식별한다', () => {
    const option = {
      xAxis: { type: 'category', data: ['서울', '부산'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', name: '매출', data: [10, 20] }],
    };

    expect(colorSelectionFromChartClick('bar', {
      componentType: 'series',
      seriesIndex: 0,
      dataIndex: 1,
      color: 'rgb(255, 176, 0)',
    }, option)).toMatchObject({
      scope: 'item',
      kind: 'cartesian',
      seriesName: '매출',
      dimensions: ['부산'],
      occurrence: 0,
      label: '매출 · 부산',
      renderedColor: '#FFB000',
    });
  });

  it('가로 막대도 범주형 Y축 값을 사용한다', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: ['서울', '부산'] },
      series: [{ type: 'bar', name: '매출', data: [10, 20] }],
    };

    expect(itemTargetAt(option, 'bar', 0, 0)).toMatchObject({ dimensions: ['서울'] });
  });

  it('히트맵 셀을 실제 축 라벨로 식별한다', () => {
    const option = {
      xAxis: { type: 'category', data: ['1월', '2월'] },
      yAxis: { type: 'category', data: ['매출', '비용'] },
      series: [{ type: 'heatmap', name: '값', data: [[1, 0, 20]] }],
    };

    expect(itemTargetAt(option, 'heatmap', 0, 0)).toMatchObject({
      kind: 'heatmap',
      seriesName: '__heatmap__',
      dimensions: ['2월', '매출'],
    });
  });

  it('중복 카테고리를 occurrence로 구분하고 다시 찾는다', () => {
    const option = {
      xAxis: { type: 'category', data: ['서울', '서울'] },
      yAxis: { type: 'value' },
      series: [{ type: 'line', name: '매출', data: [10, 20] }],
    };
    const selection = colorSelectionFromChartClick('line', {
      componentType: 'series',
      seriesIndex: 0,
      dataIndex: 1,
    }, option);

    expect(selection).toMatchObject({ occurrence: 1 });
    expect(locateColorSelection(option, 'line', selection)).toEqual({ seriesIndex: 0, dataIndex: 1 });
  });

  it('분산형 점을 x·y 값과 occurrence로 식별하고 다시 찾는다', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      series: [{ type: 'scatter', name: '값', data: [[5, 10], [5, 20], [5, 20]] }],
    };
    const selection = colorSelectionFromChartClick('scatter', {
      componentType: 'series',
      seriesIndex: 0,
      dataIndex: 2,
    }, option);

    expect(selection).toMatchObject({
      kind: 'scatter',
      seriesName: '값',
      dimensions: [5, 20],
      occurrence: 1,
      label: '값 · 5, 20',
    });
    expect(locateColorSelection(option, 'scatter', selection)).toEqual({ seriesIndex: 0, dataIndex: 2 });
  });

  it('원형 정적 대상은 중복 이름을 한 번만 노출한다', () => {
    expect(staticColorSelections(
      'pie',
      [{ name: '지역' }, { name: '값' }],
      [['서울', 10], ['서울', 20], ['부산', 30]],
    ).map((item) => item.label)).toEqual(['서울', '부산']);
  });

  it('CSS rgb 색상을 HEX로 변환한다', () => {
    expect(cssColorToHex('rgba(17, 34, 51, 0.5)')).toBe('#112233');
  });
});
