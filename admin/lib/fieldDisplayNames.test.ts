import { describe, expect, it } from 'vitest';
import { seriesDisplayNames } from '@chartsdk/chart-options/fieldDisplayNames';
import { tooltipFieldsFor } from '@chartsdk/chart-options/tooltip';

const builder = {
  xAxis: 'sales.region',
  yAxis: [{ column: 'sales.amount', agg: 'sum' }],
  fieldDisplayNames: {
    'sales.region': '지역',
    'sales.amount': '매출액',
  },
};

describe('chart field display names', () => {
  it('uses snapshots for labels while retaining physical result keys', () => {
    const columns = [
      { name: 'region', type: 'text' },
      { name: 'sum_amount', type: 'numeric' },
    ];

    expect(seriesDisplayNames(builder, columns)).toEqual({
      sum_amount: '매출액 합계',
    });
    expect(tooltipFieldsFor({
      chartType: 'bar',
      columns,
      options: {},
      builderConfig: builder,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '지역', kind: 'category' }),
      expect.objectContaining({
        label: '매출액 합계',
        kind: 'measure',
        seriesName: 'sum_amount',
      }),
    ]));
  });

  it('prefers the per-chart measure alias to the datasource snapshot', () => {
    expect(seriesDisplayNames({
      ...builder,
      yAxis: [{ column: 'sales.amount', agg: 'sum', alias: '순매출' }],
    }, [
      { name: 'region' },
      { name: '순매출' },
    ])).toEqual({});
  });
});
