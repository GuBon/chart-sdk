import { describe, expect, it } from 'vitest';
import {
  AXIS_DISPLAY_NAMES_KEY,
  SERIES_DISPLAY_NAMES_KEY,
} from '@chartsdk/chart-options/fieldDisplayNames';
import { hydrateValueFormat } from '@chartsdk/chart-options/valueFormat';

describe('display-name formatter hydration', () => {
  it('formats legend and heatmap labels without renaming physical series or axis data', () => {
    const option: Record<string, any> = {
      [SERIES_DISPLAY_NAMES_KEY]: { sum_amount: '매출액 합계' },
      __chartsdkTooltip: {
        mode: 'custom',
        chartType: 'heatmap',
        template: '{y}: {value}',
      },
      legend: { show: true },
      tooltip: {},
      xAxis: { type: 'category', data: ['서울'] },
      yAxis: {
        type: 'category',
        data: ['sum_amount'],
        axisLabel: {},
        [AXIS_DISPLAY_NAMES_KEY]: { sum_amount: '매출액 합계' },
      },
      series: [{ name: 'sum_amount', type: 'heatmap', data: [[0, 0, 10]] }],
    };

    hydrateValueFormat(option);

    expect(option.legend.formatter('sum_amount')).toBe('매출액 합계');
    expect(option.yAxis.axisLabel.formatter('sum_amount')).toBe('매출액 합계');
    expect(option.tooltip.formatter({ seriesName: 'sum_amount', value: [0, 0, 10] }))
      .toBe('매출액 합계: 10');
    expect(option.series[0].name).toBe('sum_amount');
    expect(option.yAxis.data).toEqual(['sum_amount']);
    expect(option[SERIES_DISPLAY_NAMES_KEY]).toBeUndefined();
    expect(option.yAxis[AXIS_DISPLAY_NAMES_KEY]).toBeUndefined();
  });

  it('does not create a legend when the option has none', () => {
    const option: Record<string, any> = {
      [SERIES_DISPLAY_NAMES_KEY]: { amount: '매출액' },
      series: [{ name: 'amount' }],
    };

    hydrateValueFormat(option);

    expect(option.legend).toBeUndefined();
  });
});
