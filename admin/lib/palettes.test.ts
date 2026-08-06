import { describe, expect, it } from 'vitest';
import { schemeCategory10 } from 'd3-scale-chromatic';
import { defaultsFor, optionsWithDefaults, switchMajor, type MajorType } from '@chartsdk/chart-options';
import {
  D3_CATEGORICAL_CHOICES,
  D3_CYCLICAL_CHOICES,
  D3_DIVERGING_CHOICES,
  D3_SEQUENTIAL_CHOICES,
  applyPaletteDirection,
  applyPalettePreset,
  d3Palette,
  d3ThemeColorAt,
  paletteChoicesForChartType,
  paletteFamilyForChartType,
  paletteFamilyOfPreset,
  resolveSeriesColorMap,
} from '@chartsdk/chart-options/palettes';

describe('D3 색상 테마 계약', () => {
  it('선정한 35개 테마를 네 family로 제공한다', () => {
    expect(D3_CATEGORICAL_CHOICES).toHaveLength(9);
    expect(D3_SEQUENTIAL_CHOICES).toHaveLength(15);
    expect(D3_DIVERGING_CHOICES).toHaveLength(9);
    expect(D3_CYCLICAL_CHOICES).toHaveLength(2);
    expect([
      ...D3_CATEGORICAL_CHOICES,
      ...D3_SEQUENTIAL_CHOICES,
      ...D3_DIVERGING_CHOICES,
      ...D3_CYCLICAL_CHOICES,
    ]).toHaveLength(35);
  });

  it('범주형 색상은 하드코딩하지 않고 D3 scheme 원본 순서를 사용한다', () => {
    expect(d3Palette('category10')).toEqual(schemeCategory10.map((color) => color.toUpperCase()));
    expect(d3Palette('category10')).toHaveLength(10);
    expect(d3Palette('paired')).toHaveLength(12);
  });

  it('연속형 색상은 D3 interpolator에서 요청한 개수만큼 동적으로 생성한다', () => {
    const viridis = d3Palette('viridis', 7);
    expect(viridis).toHaveLength(7);
    expect(viridis[0]).toBe(d3ThemeColorAt('viridis', 0));
    expect(viridis[3]).toBe(d3ThemeColorAt('viridis', 0.5));
    expect(viridis[6]).toBe(d3ThemeColorAt('viridis', 1));
    expect(paletteFamilyOfPreset('rainbow')).toBe('cyclical');
    expect(paletteFamilyOfPreset('rdbu')).toBe('diverging');
  });
});

describe('차트 대분류별 D3 테마 배치 정책', () => {
  it('영역 지도·행렬 히트맵은 Sequential, 나머지는 Categorical을 먼저 배치한다', () => {
    const expected: Record<MajorType, string> = {
      bar: 'categorical',
      line: 'categorical',
      pie: 'categorical',
      scatter: 'categorical',
      boxplot: 'categorical',
      heatmap: 'sequential',
      map: 'sequential',
      geoscatter: 'categorical',
    };
    for (const [chartType, family] of Object.entries(expected)) {
      expect(paletteFamilyForChartType(chartType)).toBe(family);
    }

    const barChoices = paletteChoicesForChartType('bar');
    const mapChoices = paletteChoicesForChartType('map');
    expect(barChoices).toHaveLength(35);
    expect(mapChoices).toHaveLength(35);
    expect(barChoices.slice(0, 9).map((choice) => choice.value)).toEqual(
      D3_CATEGORICAL_CHOICES.map((choice) => choice.value),
    );
    expect(mapChoices.slice(0, 15).map((choice) => choice.value)).toEqual(
      D3_SEQUENTIAL_CHOICES.map((choice) => choice.value),
    );
    expect(new Set(barChoices.map((choice) => choice.value))).toEqual(
      new Set(mapChoices.map((choice) => choice.value)),
    );
  });

  it('권장 family와 다른 테마도 적용하고 현재 차트군의 마지막 선택을 기억한다', () => {
    const sequentialBar = applyPalettePreset(defaultsFor('bar'), 'bar', 'viridis');
    expect(sequentialBar.palettePreset).toBe('viridis');
    expect(sequentialBar.palette).toEqual(d3Palette('viridis'));
    expect(sequentialBar.colorTheme).toMatchObject({ version: 3, seriesPreset: 'viridis' });

    const categoricalMap = applyPalettePreset(defaultsFor('map'), 'map', 'tableau10');
    expect(categoricalMap.palettePreset).toBe('tableau10');
    expect(categoricalMap.palette).toEqual(d3Palette('tableau10'));
    expect(categoricalMap.colorTheme).toMatchObject({ version: 3, valuePreset: 'tableau10' });
  });

  it('연속형 테마는 시리즈 수에 맞춰 전체 그라데이션에 고르게 배정한다', () => {
    const viridis = d3Palette('viridis', 7);
    expect(resolveSeriesColorMap(['s1', 's2', 's3'], viridis, {}, true)).toEqual({
      s1: viridis[0],
      s2: viridis[3],
      s3: viridis[6],
    });

    const names = Array.from({ length: 10 }, (_unused, index) => `s${index}`);
    const spread = resolveSeriesColorMap(names, ['#000000', '#FFFFFF'], {}, true);
    expect(Object.keys(spread)).toHaveLength(10);
    expect(spread.s0).toBe('#000000');
    expect(spread.s5).toBe('#8E8E8E');
    expect(spread.s9).toBe('#FFFFFF');
  });

  it('새 차트와 CARTO 기반 기존 차트를 차트군의 첫 D3 테마로 정규화한다', () => {
    const freshBar = defaultsFor('bar');
    const freshMap = defaultsFor('map');
    expect(freshBar.palettePreset).toBe('category10');
    expect(freshMap.palettePreset).toBe('blues');
    expect(freshBar.colorTheme).toMatchObject({ version: 3, seriesPreset: 'category10' });
    expect(freshMap.colorTheme).toMatchObject({ version: 3, valuePreset: 'blues' });

    const legacyBar = optionsWithDefaults('bar', {
      palettePreset: 'safe',
      palette: ['#88CCEE', '#CC6677'],
      colorMap: { 매출: '#123456' },
    });
    const legacyMap = optionsWithDefaults('map', {
      palettePreset: 'teal',
      palette: ['#D1EEEA', '#2A5674'],
      itemColorOverrides: [{ kind: 'map', seriesName: '__map__', dimensions: ['서울'], occurrence: 0, color: '#654321' }],
    });
    expect(legacyBar.palettePreset).toBe('category10');
    expect(legacyBar.palette).toEqual(d3Palette('category10'));
    expect(legacyBar.colorMap).toEqual({ 매출: '#123456' });
    expect(legacyMap.palettePreset).toBe('blues');
    expect(legacyMap.palette).toEqual(d3Palette('blues'));
    expect(legacyMap.itemColorOverrides).toHaveLength(1);
  });

  it('차트군별 마지막 테마와 방향을 기억하며 직접 지정 색상은 보존한다', () => {
    const map = switchMajor(defaultsFor('bar'), 'bar', 'map').next;
    const divergingMap = applyPaletteDirection(
      applyPalettePreset({
        ...map,
        colorMap: { 매출: '#123456' },
        itemColorOverrides: [{ kind: 'map', seriesName: '__map__', dimensions: ['서울'], occurrence: 0, color: '#654321' }],
      }, 'map', 'rdbu'),
      'map',
      true,
    );
    const bar = switchMajor(divergingMap, 'map', 'bar').next;
    const continuousBar = applyPalettePreset(bar, 'bar', 'viridis');
    const restoredMap = switchMajor(continuousBar, 'bar', 'map').next;

    expect(restoredMap.palettePreset).toBe('rdbu');
    expect(restoredMap.palette).toEqual(d3Palette('rdbu'));
    expect(restoredMap.paletteReversed).toBe(true);
    expect(restoredMap.colorTheme).toMatchObject({
      seriesPreset: 'viridis',
      valuePreset: 'rdbu',
      valueReversed: true,
    });
    expect(restoredMap.colorMap).toEqual({ 매출: '#123456' });
    expect(restoredMap.itemColorOverrides).toHaveLength(1);
  });
});
