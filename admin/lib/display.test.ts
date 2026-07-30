import { describe, expect, it } from 'vitest';
import {
  CHART_SIZE_PRESETS,
  FONT_FAMILY_CHOICES,
  FONT_FAMILY_STACKS,
  resolveChartDesignSize,
  resolveChartFontFamilies,
  resolveChartLayoutMetrics,
  resolveChartTitleText,
  resolveChartTypography,
} from '@chartsdk/chart-options/display';
import { responsiveTitlePatch, usesResponsiveTitle, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';
import { migrateLegacyInteractionOptions } from '@chartsdk/chart-options';

describe('차트 논리 크기와 글꼴 계약', () => {
  it('사용자 선택지는 기본·Pretendard·Noto Sans KR 세 가지로 고정한다', () => {
    expect(FONT_FAMILY_CHOICES).toEqual([
      { value: 'default', label: '기본' },
      { value: 'pretendard', label: 'Pretendard' },
      { value: 'notoSansKr', label: 'Noto Sans KR' },
    ]);
  });

  it('프리셋과 사용자 지정 크기를 정규화한다', () => {
    expect(resolveChartDesignSize({ display: { preset: 'fhd' } })).toMatchObject({ width: 1920, height: 1080 });
    expect(resolveChartDesignSize({ display: { preset: 'standardPortrait' } })).toMatchObject({
      preset: 'standardPortrait', width: 360, height: 640,
    });
    expect(resolveChartDesignSize({ display: { preset: 'custom', width: 9999, height: 120 } })).toMatchObject({
      preset: 'custom', width: 3840, height: 180,
    });
  });

  it('모든 가로 프리셋에 너비와 높이를 뒤집은 세로 프리셋을 제공한다', () => {
    const presets = new Map(CHART_SIZE_PRESETS.map((preset) => [preset.preset, preset]));
    for (const [landscape, portrait] of [
      ['small', 'smallPortrait'],
      ['standard', 'standardPortrait'],
      ['large', 'largePortrait'],
      ['hd', 'hdPortrait'],
      ['fhd', 'fhdPortrait'],
    ] as const) {
      expect(presets.get(portrait)).toMatchObject({
        width: presets.get(landscape)?.height,
        height: presets.get(landscape)?.width,
      });
    }
  });

  it('자동 글꼴은 논리 크기와 전체 배율을 반영한다', () => {
    expect(resolveChartTypography({ display: { preset: 'standard' }, typography: { scale: 100 } }))
      .toMatchObject({ title: 18, legend: 12, axis: 12 });
    expect(resolveChartTypography({ display: { preset: 'fhd' }, typography: { scale: 150 } }))
      .toMatchObject({ title: 39, legend: 24, axis: 24, dataLabel: 24, tooltip: 24 });
    expect(resolveChartTypography({ display: { preset: 'fhdPortrait' }, typography: { scale: 150 } }))
      .toMatchObject({ title: 39, legend: 24, axis: 24, dataLabel: 24, tooltip: 24 });
  });

  it('사용자 지정 논리 크기는 가로·세로를 모두 반영하고 직접 지정 px는 크기와 무관하게 유지한다', () => {
    const standardHeight = resolveChartTypography({
      display: { preset: 'custom', width: 640, height: 360 },
      typography: { scale: 100 },
    });
    const tall = resolveChartTypography({
      display: { preset: 'custom', width: 640, height: 1440 },
      typography: { scale: 100 },
    });
    expect(standardHeight).toMatchObject({ title: 18, legend: 12 });
    expect(tall).toMatchObject({ title: 25, legend: 17 });

    const fixed = { titleFontSize: 31, legendFontSize: 19, axisFontSize: 15, dataLabelFontSize: 13, tooltipFontSize: 14 };
    expect(resolveChartTypography({ display: { preset: 'small' }, typography: fixed }))
      .toEqual(resolveChartTypography({ display: { preset: 'fhd' }, typography: fixed }));
  });

  it('요소별로 자동과 직접 지정을 섞으면 자동인 요소만 전체 배율을 따른다', () => {
    const mixed = resolveChartTypography({ typography: { scale: 120, titleFontSize: 30 } });
    expect(mixed).toMatchObject({ title: 30, legend: 14, axis: 14, dataLabel: 14, tooltip: 14 });

    // 직접 지정한 제목은 배율을 바꿔도 그대로다.
    expect(resolveChartTypography({ typography: { scale: 80, titleFontSize: 30 } }).title).toBe(30);
  });

  it('직접 지정 글꼴에서 제목·범례 예약 높이를 함께 늘린다', () => {
    const options = { typography: { titleFontSize: 32, legendFontSize: 20 } };
    expect(resolveChartTypography(options)).toMatchObject({ title: 32, legend: 20 });
    expect(resolveChartLayoutMetrics(options)).toEqual({ titleHeight: 43, legendHeight: 34, visualMapHeight: 46 });
  });

  it('폐기된 typography.mode 는 자동이면 잔존 px 를 버리고 직접 지정이면 px 를 살린다', () => {
    const stale = migrateLegacyInteractionOptions(
      { typography: { mode: 'auto', scale: 100, titleFontSize: 44, legendFontSize: 30 } },
      'bar',
    );
    expect(stale.typography).toEqual({ scale: 100 });
    expect(resolveChartTypography(stale)).toMatchObject({ title: 18, legend: 12 });

    const kept = migrateLegacyInteractionOptions(
      { typography: { mode: 'custom', scale: 100, titleFontSize: 44, legendFontSize: 30 } },
      'bar',
    );
    expect(kept.typography).toEqual({ scale: 100, titleFontSize: 44, legendFontSize: 30 });
    expect(resolveChartTypography(kept)).toMatchObject({ title: 44, legend: 30 });
  });

  it('요소별 글꼴을 각각 해석하고 기본에서만 스택을 내보내지 않는다', () => {
    expect(resolveChartFontFamilies({})).toEqual({
      title: null, legend: null, axis: null, dataLabel: null, tooltip: null,
    });
    expect(resolveChartFontFamilies({
      typography: {
        titleFontFamily: 'pretendard',
        legendFontFamily: 'notoSansKr',
        axisFontFamily: '나눔손글씨',
      },
    })).toEqual({
      title: FONT_FAMILY_STACKS.pretendard,
      legend: FONT_FAMILY_STACKS.notoSansKr,
      axis: null,
      dataLabel: null,
      tooltip: null,
    });
  });

  it('구 전역 글꼴 저장본은 모든 요소의 폰트로 이관한다', () => {
    const migrated = migrateLegacyInteractionOptions(
      { typography: { fontFamily: 'notoSansKr', titleFontFamily: 'pretendard' } },
      'bar',
    );
    expect(migrated.typography).toMatchObject({
      titleFontFamily: 'pretendard',
      legendFontFamily: 'notoSansKr',
      axisFontFamily: 'notoSansKr',
      dataLabelFontFamily: 'notoSansKr',
      tooltipFontFamily: 'notoSansKr',
    });
    expect(migrated.typography?.fontFamily).toBeUndefined();
  });

  it('제거된 초기 글꼴 선택값은 빈 선택지가 되지 않고 기본으로 정규화한다', () => {
    const migrated = migrateLegacyInteractionOptions(
      { typography: { titleFontFamily: 'serif', legendFontFamily: 'mono' } },
      'bar',
    );
    expect(migrated.typography).toMatchObject({
      titleFontFamily: 'default',
      legendFontFamily: 'default',
    });
  });

  it('구 지도 계열별 스타일은 계열 색상과 포인트 공통 스타일로 이관한다', () => {
    const migrated = migrateLegacyInteractionOptions({
      colorMap: { 매장: '#ABCDEF' },
      geoSeriesStyles: {
        온라인: {
          color: '#0055AA',
          opacity: 0.8,
          borderWidth: 2,
          symbol: 'triangle',
          symbolSize: 16,
        },
        매장: { color: '#DD5500', opacity: 0.65 },
      },
    }, 'geoscatter');

    expect(migrated.geoSeriesStyles).toBeUndefined();
    expect(migrated.colorMap).toEqual({ 온라인: '#0055AA', 매장: '#ABCDEF' });
    expect(migrated.geoscatter).toMatchObject({
      opacity: 0.8,
      borderWidth: 2,
      symbol: 'triangle',
      symbolSize: 16,
    });
  });
});

describe('제목 텍스트 방향', () => {
  it('세로쓰기는 코드포인트마다 줄을 나누고 예약 높이를 줄 수만큼 늘린다', () => {
    const options = { title: '매출추이', titleDirection: 'vertical' };
    expect(resolveChartTitleText(options)).toBe('매\n출\n추\n이');
    // 가로: ceil(18×1.2)+4 = 26 → 세로 4줄: 22×4+4 = 92
    expect(resolveChartLayoutMetrics(options).titleHeight).toBe(92);
    expect(resolveChartLayoutMetrics({ title: '매출추이' }).titleHeight).toBe(26);
  });

  it('서로게이트 쌍을 한 글자로 센다', () => {
    const options = { title: '📈추이', titleDirection: 'vertical' };
    expect(resolveChartTitleText(options)).toBe('📈\n추\n이');
    expect(resolveChartLayoutMetrics(options).titleHeight).toBe(70);
  });

  it('제목이 비어도 예약 높이를 1줄 아래로 떨어뜨리지 않는다', () => {
    expect(resolveChartLayoutMetrics({ title: '', titleDirection: 'vertical' }).titleHeight).toBe(26);
  });

  it('세로 제목에는 폭 제한·말줄임을 주입하지 않는다', () => {
    const vertical = { title: { text: '매\n출' } };
    expect(usesResponsiveTitle(vertical)).toBe(false);
    expect(withResponsiveTitle(vertical, 400)).toEqual(vertical);

    const horizontal = { title: { text: '매출' } };
    expect(usesResponsiveTitle(horizontal)).toBe(true);
    expect(withResponsiveTitle(horizontal, 400).title).toEqual({
      text: '매출',
      ...responsiveTitlePatch(400).title as Record<string, unknown>,
    });
  });
});
