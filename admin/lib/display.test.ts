import { describe, expect, it } from 'vitest';
import { resolveChartDesignSize, resolveChartLayoutMetrics, resolveChartTypography } from '@chartsdk/chart-options/display';

describe('차트 논리 크기와 글꼴 계약', () => {
  it('프리셋과 사용자 지정 크기를 정규화한다', () => {
    expect(resolveChartDesignSize({ display: { preset: 'fhd' } })).toMatchObject({ width: 1920, height: 1080 });
    expect(resolveChartDesignSize({ display: { preset: 'custom', width: 9999, height: 120 } })).toMatchObject({
      preset: 'custom', width: 3840, height: 180,
    });
  });

  it('자동 글꼴은 논리 크기와 전체 배율을 반영한다', () => {
    expect(resolveChartTypography({ display: { preset: 'standard' }, typography: { mode: 'auto', scale: 100 } }))
      .toMatchObject({ title: 18, legend: 12, axis: 12 });
    expect(resolveChartTypography({ display: { preset: 'fhd' }, typography: { mode: 'auto', scale: 150 } }))
      .toMatchObject({ title: 39, legend: 24, axis: 24, dataLabel: 24, tooltip: 24 });
  });

  it('직접 지정 글꼴에서 제목·범례 예약 높이를 함께 늘린다', () => {
    const options = {
      typography: { mode: 'custom', titleFontSize: 32, legendFontSize: 20 },
    };
    expect(resolveChartTypography(options)).toMatchObject({ title: 32, legend: 20 });
    expect(resolveChartLayoutMetrics(options)).toEqual({ titleHeight: 43, legendHeight: 34, visualMapHeight: 46 });
  });
});
