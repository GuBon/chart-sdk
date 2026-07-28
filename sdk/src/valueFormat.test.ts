import { describe, expect, it } from 'vitest';
import { hydrateValueFormat } from '@chartsdk/chart-options/valueFormat';

describe('공통 툴팁 hydration', () => {
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
