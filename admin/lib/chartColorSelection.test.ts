import { describe, expect, it } from 'vitest';
import {
  bubbleSizeColumns,
  colorSelectionFromChartClick,
  colorSelectionFromItemTarget,
  cssColorToHex,
  itemTargetAt,
  locateColorSelection,
  staticColorSelections,
} from './chartColorSelection';

describe('chart color selection', () => {
  it('저장된 포인트 지도 항목을 값·색상 칩용 선택으로 복원한다', () => {
    expect(colorSelectionFromItemTarget({
      kind: 'geoscatter',
      seriesName: '__geoscatter__',
      dimensions: [126.978, 37.5665],
      occurrence: 0,
    })).toMatchObject({
      scope: 'item',
      label: '126.978, 37.5665',
      dimensions: [126.978, 37.5665],
    });
  });

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

  it('행렬 히트맵 셀을 실제 축 라벨로 식별한다', () => {
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

  it('map 대분류의 geo heatmap 점은 영역이 아니라 좌표 항목으로 식별한다', () => {
    const option = {
      geo: { map: 'kr-sido' },
      series: [{
        type: 'heatmap',
        coordinateSystem: 'geo',
        name: '온라인',
        data: [{ name: '서울점', value: [126.978, 37.5665, 120, 30] }],
      }],
    };

    const selection = colorSelectionFromChartClick('map', {
      componentType: 'series',
      seriesIndex: 0,
      dataIndex: 0,
    }, option);
    expect(selection).toMatchObject({
      kind: 'geoscatter',
      dimensions: [126.978, 37.5665],
      occurrence: 0,
    });
    expect(locateColorSelection(option, 'map', selection)).toEqual({ seriesIndex: 0, dataIndex: 0 });
  });

  it('원형 정적 대상은 중복 이름을 한 번만 노출한다', () => {
    expect(staticColorSelections(
      'pie',
      [{ name: '지역' }, { name: '값' }],
      [['서울', 10], ['서울', 20], ['부산', 30]],
    ).map((item) => item.label)).toEqual(['서울', '부산']);
  });

  it('지도 계열 기준값을 정적 색상 대상으로 노출한다', () => {
    const selections = staticColorSelections(
      'geoscatter',
      [
        { name: '__chartsdk_longitude', type: 'number' },
        { name: '__chartsdk_latitude', type: 'number' },
        { name: '__chartsdk_series', type: 'text' },
      ],
      [[126.978, 37.5665, '온라인'], [129.0756, 35.1796, '매장'], [127.1, 37.4, '온라인']],
    );

    expect(selections).toEqual([
      { scope: 'series', seriesName: '온라인', label: '온라인' },
      { scope: 'series', seriesName: '매장', label: '매장' },
    ]);
  });

  it('계열 기준이 없는 지도는 변환기와 같은 기본 계열명을 사용한다', () => {
    expect(staticColorSelections(
      'map',
      [{ name: '__chartsdk_area_name' }, { name: '__chartsdk_area_value' }],
      [['서울특별시', 120]],
    ).map((selection) => selection.seriesName)).toEqual(['값']);

    expect(staticColorSelections(
      'map',
      [{ name: '__chartsdk_longitude' }, { name: '__chartsdk_latitude' }],
      [[126.978, 37.5665]],
    ).map((selection) => selection.seriesName)).toEqual(['밀도']);

    expect(staticColorSelections(
      'geoscatter',
      [{ name: '__chartsdk_longitude' }, { name: '__chartsdk_latitude' }],
      [[126.978, 37.5665]],
    ).map((selection) => selection.seriesName)).toEqual(['포인트']);
  });

  it('버블 크기 컬럼은 색상 시리즈 대상에서 제외한다', () => {
    const selections = staticColorSelections(
      'scatter',
      [
        { name: 'x', type: 'number' },
        { name: 'y', type: 'numeric' },
        { name: 'size', type: 'integer' },
      ],
      [[1, 10, 3]],
      { variant: 'bubble', scatter: { bubbleField: 'size' } },
    );

    expect(selections.map((selection) => selection.label)).toEqual(['y']);
  });

  it('버블 크기 선택기는 X·Y 이후의 숫자 컬럼만 제공한다', () => {
    expect(bubbleSizeColumns([
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'label', type: 'text' },
      { name: 'size', type: 'double precision' },
    ]).map((column) => column.name)).toEqual(['size']);
  });

  it('CSS rgb 색상을 HEX로 변환한다', () => {
    expect(cssColorToHex('rgba(17, 34, 51, 0.5)')).toBe('#112233');
  });
});
