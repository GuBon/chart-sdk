import { describe, expect, it } from 'vitest';
import { hydrateValueFormat, verticalizeAxisLabel } from '@chartsdk/chart-options/valueFormat';

describe('공통 툴팁 hydration', () => {
  it('선택한 실제 필드 레이블과 계열 색상 마커만 축 툴팁에 렌더링한다', () => {
    const marker = '<span style="background:#5470c6"></span>';
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'comma', yAxis: 'raw', unit: '원' },
      __chartsdkTooltip: {
        mode: 'fields',
        chartType: 'bar',
        showSeriesColor: true,
        fields: [
          { key: 'x:sales.region', label: 'region', role: '가로축', kind: 'category', defaultVisible: true },
          { key: 'measure:sum:sales.amount:0', label: '월 매출', role: '합계', kind: 'measure', defaultVisible: true },
        ],
      },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.tooltip.formatter([
      { seriesName: '월 매출', axisValueLabel: '서울', name: '서울', value: 1234, marker },
    ])).toBe(`${marker}region: 서울<br/>월 매출: 1,234원`);
  });

  it('원형의 구성비와 색상 마커를 각각 독립적으로 제외할 수 있다', () => {
    const option: Record<string, any> = {
      __chartsdkTooltip: {
        mode: 'fields',
        chartType: 'pie',
        showSeriesColor: false,
        fields: [
          { key: 'category:product', label: 'product', role: '항목', kind: 'category', defaultVisible: true },
          { key: 'derived:percent', label: '구성비', role: '계산값', kind: 'percent', defaultVisible: true },
        ],
      },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.tooltip.formatter({
      name: '<의류>',
      value: 42,
      percent: 37.25,
      marker: '<span>marker</span>',
    })).toBe('product: &lt;의류&gt;<br/>구성비: 37.3%');
  });

  it('박스플롯의 5수 요약과 이상치 필드를 데이터 종류에 맞게 구분한다', () => {
    const fields = [
      { key: 'category:group', label: 'group', role: '카테고리', kind: 'category', defaultVisible: true },
      { key: 'box:min:value', label: 'value 최솟값', role: '계산값', kind: 'boxMin', defaultVisible: true },
      { key: 'box:median:value', label: 'value 중앙값', role: '계산값', kind: 'boxMedian', defaultVisible: true },
      { key: 'box:max:value', label: 'value 최댓값', role: '계산값', kind: 'boxMax', defaultVisible: true },
      { key: 'box:outlier:value', label: 'value 이상치', role: '계산값', kind: 'boxOutlier', defaultVisible: true },
    ];
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'comma', yAxis: 'raw', unit: '' },
      __chartsdkTooltip: { mode: 'fields', chartType: 'boxplot', fields },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.tooltip.formatter({
      name: 'A',
      value: [0, 10, 20, 30, 40, 50],
    })).toBe('group: A<br/>value 최솟값: 10<br/>value 중앙값: 30<br/>value 최댓값: 50');
    expect(option.tooltip.formatter({
      seriesId: '__chartsdk_boxplot_outliers',
      name: 'A',
      value: ['A', 1000],
    })).toBe('group: A<br/>value 이상치: 1,000');
  });

  it('지도 템플릿의 필드를 값 포맷과 함께 안전한 HTML로 복원한다', () => {
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'comma', yAxis: 'raw', unit: '원' },
      __chartsdkTooltip: { chartType: 'map', template: '<지역> {name}\n{series}: {value}' },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.__chartsdkValueFormat).toBeUndefined();
    expect(option.__chartsdkTooltip).toBeUndefined();
    expect(option.tooltip.formatter({ seriesName: '매출', name: '<서울>', value: 1234 }))
      .toBe('&lt;지역&gt; &lt;서울&gt;<br/>매출: 1,234원');
  });

  it('지도 포인트 템플릿은 경도·위도·선택 크기값을 각각 치환한다', () => {
    const option: Record<string, any> = {
      __chartsdkTooltip: {
        chartType: 'geoscatter',
        template: '{series}\n{lng}, {lat}\n값: {value}',
      },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.tooltip.formatter({ seriesName: '지점', value: [127.1, 37.5, 42] }))
      .toBe('지점<br/>127.1, 37.5<br/>값: 42');
  });

  it('축 툴팁의 여러 계열을 모두 렌더링하고 값 포맷을 적용한다', () => {
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'comma', yAxis: 'raw', unit: '명' },
      __chartsdkTooltip: { chartType: 'bar', template: '{series}\n{name}: {value}' },
      tooltip: {},
    };

    hydrateValueFormat(option);

    expect(option.tooltip.formatter([
      { seriesName: '2020', name: '서울', value: 9_911_088 },
      { seriesName: '2021', name: '서울', value: 9_736_027 },
    ])).toBe('2020<br/>서울: 9,911,088명<br/>2021<br/>서울: 9,736,027명');
  });

  it('원형·산점도 전용 필드를 치환한다', () => {
    const pie: Record<string, any> = {
      __chartsdkTooltip: { chartType: 'pie', template: '{name}: {value} ({percent}%)' },
      tooltip: {},
    };
    const scatter: Record<string, any> = {
      __chartsdkTooltip: { chartType: 'scatter', template: 'X={x}, Y={y}, 값={value}' },
      tooltip: {},
    };

    hydrateValueFormat(pie);
    hydrateValueFormat(scatter);

    expect(pie.tooltip.formatter({ name: '서울', value: 42, percent: 37.5 })).toBe('서울: 42 (37.5%)');
    expect(scatter.tooltip.formatter({ value: [127.1, 37.5] })).toBe('X=127.1, Y=37.5, 값=37.5');
  });

  it('히트맵 축 인덱스를 카테고리명으로, 박스 플롯을 5수 요약으로 렌더링한다', () => {
    const heatmap: Record<string, any> = {
      __chartsdkTooltip: { chartType: 'heatmap', template: '{x} / {y}: {value}' },
      tooltip: {},
      xAxis: { data: ['서울', '부산'] },
      yAxis: { data: ['2020', '2021'] },
    };
    const boxplot: Record<string, any> = {
      __chartsdkTooltip: { chartType: 'boxplot', template: '{min}, {q1}, {median}, {q3}, {max}' },
      tooltip: {},
    };

    hydrateValueFormat(heatmap);
    hydrateValueFormat(boxplot);

    expect(heatmap.tooltip.formatter({ value: [1, 0, 123] })).toBe('부산 / 2020: 123');
    expect(boxplot.tooltip.formatter({ value: [0, 10, 20, 30, 40, 50] })).toBe('10, 20, 30, 40, 50');
  });

  it('박스 플롯 이상치 산점도는 5수 요약 대신 이상치 값을 렌더링한다', () => {
    const boxplot: Record<string, any> = {
      __chartsdkTooltip: { chartType: 'boxplot', template: '{min}, {q1}, {median}, {q3}, {max}' },
      __chartsdkValueFormat: { tooltip: 'comma', yAxis: 'raw', unit: '' },
      tooltip: {},
      yAxis: {},
    };

    hydrateValueFormat(boxplot);

    expect(boxplot.tooltip.formatter({
      seriesId: '__chartsdk_boxplot_outliers',
      name: 'A',
      value: ['A', 1000],
    })).toBe('A<br/>이상치: 1,000');
  });
});

describe('축 라벨 실제 세로쓰기 hydration', () => {
  it('한글·결합문자·이모지 묶음을 회전하지 않고 grapheme 단위로 쌓는다', () => {
    expect(verticalizeAxisLabel('서울특별시')).toBe('서\n울\n특\n별\n시');
    expect(verticalizeAxisLabel(`가족👨‍👩‍👧‍👦e\u0301`)).toBe(`가\n족\n👨‍👩‍👧‍👦\ne\u0301`);
  });

  it('가로 막대에서도 논리 X·Y축 역할에 맞춰 원문과 숫자 포맷을 세로로 쌓는다', () => {
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'raw', yAxis: 'comma', unit: '원' },
      // 가로 막대: 논리 Y 값축은 실제 X축, 논리 X 범주축은 실제 Y축이다.
      xAxis: {
        type: 'value',
        __chartsdkVerticalLabel: 'y',
        axisLabel: { formatter: '{value}원' },
      },
      yAxis: {
        type: 'category',
        __chartsdkVerticalLabel: 'x',
        axisLabel: { rotate: 30 },
      },
    };

    hydrateValueFormat(option);

    expect(option.xAxis.__chartsdkVerticalLabel).toBeUndefined();
    expect(option.yAxis.__chartsdkVerticalLabel).toBeUndefined();
    expect(option.xAxis.axisLabel.rotate).toBeUndefined();
    expect(option.yAxis.axisLabel.rotate).toBe(30);
    expect(option.xAxis.axisLabel.formatter(1234)).toBe('1\n,\n2\n3\n4\n원');
    expect(option.yAxis.axisLabel.formatter('서울')).toBe('서\n울');
  });

  it('히트맵의 범주형 Y축은 단위 포맷 없이 계열명을 그대로 세로쓰기한다', () => {
    const option: Record<string, any> = {
      __chartsdkValueFormat: { tooltip: 'raw', yAxis: 'comma', unit: '원' },
      yAxis: {
        type: 'category',
        __chartsdkVerticalLabel: 'y',
        axisLabel: {},
      },
    };

    hydrateValueFormat(option);

    expect(option.yAxis.axisLabel.formatter('매출액')).toBe('매\n출\n액');
  });
});
