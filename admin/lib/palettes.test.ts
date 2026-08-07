import { describe, expect, it } from 'vitest';
import { defaultsFor, optionsWithDefaults, switchMajor, type MajorType } from '@chartsdk/chart-options';
import {
  COLORBREWER_DIVERGING_CHOICES,
  COLORBREWER_QUALITATIVE_CHOICES,
  COLORBREWER_SEQUENTIAL_CHOICES,
  applyPaletteDirection,
  applyPalettePreset,
  colorBrewerColorAt,
  colorBrewerPalette,
  paletteChoicesForChartType,
  paletteFamilyForChartType,
  paletteFamilyOfPreset,
  resolveSeriesColorMap,
} from '@chartsdk/chart-options/palettes';

describe('ColorBrewer 팔레트 계약', () => {
  it('공식 35개 팔레트를 세 가지 데이터 성격으로 제공한다', () => {
    expect(COLORBREWER_QUALITATIVE_CHOICES).toHaveLength(8);
    expect(COLORBREWER_SEQUENTIAL_CHOICES).toHaveLength(18);
    expect(COLORBREWER_DIVERGING_CHOICES).toHaveLength(9);
    expect([
      ...COLORBREWER_QUALITATIVE_CHOICES,
      ...COLORBREWER_SEQUENTIAL_CHOICES,
      ...COLORBREWER_DIVERGING_CHOICES,
    ]).toHaveLength(35);
  });

  it('각 팔레트의 공식 최대 클래스 색상 배열을 그대로 사용한다', () => {
    expect(colorBrewerPalette('dark2')).toEqual([
      '#1B9E77', '#D95F02', '#7570B3', '#E7298A',
      '#66A61E', '#E6AB02', '#A6761D', '#666666',
    ]);
    expect(colorBrewerPalette('paired')).toHaveLength(12);
    expect(colorBrewerPalette('blues')).toHaveLength(9);
    expect(colorBrewerPalette('rdbu')).toHaveLength(11);
    expect(colorBrewerPalette('rdbu')[5]).toBe('#F7F7F7');
    expect(colorBrewerPalette('puor')).toEqual([
      '#7F3B08', '#B35806', '#E08214', '#FDB863', '#FEE0B6', '#F7F7F7',
      '#D8DAEB', '#B2ABD2', '#8073AC', '#542788', '#2D004B',
    ]);
  });

  it('연속 팔레트 위치 색상은 공식 정지점 사이에서 로컬 보간한다', () => {
    const blues = colorBrewerPalette('blues');
    expect(colorBrewerColorAt('blues', 0)).toBe(blues[0]);
    expect(colorBrewerColorAt('blues', 0.5)).toBe(blues[4]);
    expect(colorBrewerColorAt('blues', 1)).toBe(blues[8]);
    expect(paletteFamilyOfPreset('set1')).toBe('qualitative');
    expect(paletteFamilyOfPreset('rdbu')).toBe('diverging');
    expect(paletteFamilyOfPreset('viridis')).toBeNull();
  });
});

describe('차트 종류별 ColorBrewer 선택 정책', () => {
  it('일반 차트는 정성형, 영역 지도·히트맵은 순차형·발산형만 제공한다', () => {
    const expected: Record<MajorType, string> = {
      bar: 'qualitative',
      line: 'qualitative',
      pie: 'qualitative',
      scatter: 'qualitative',
      boxplot: 'qualitative',
      heatmap: 'sequential',
      map: 'sequential',
      geoscatter: 'qualitative',
    };
    for (const [chartType, family] of Object.entries(expected)) {
      expect(paletteFamilyForChartType(chartType)).toBe(family);
    }

    const barChoices = paletteChoicesForChartType('bar');
    const mapChoices = paletteChoicesForChartType('map');
    expect(barChoices).toHaveLength(8);
    expect(barChoices.every((choice) => choice.family === 'qualitative')).toBe(true);
    expect(mapChoices).toHaveLength(27);
    expect(mapChoices.slice(0, 18).every((choice) => choice.family === 'sequential')).toBe(true);
    expect(mapChoices.slice(18).every((choice) => choice.family === 'diverging')).toBe(true);
  });

  it('차트 의미와 맞지 않는 팔레트는 해당 차트의 기본값으로 정규화한다', () => {
    const bar = applyPalettePreset(defaultsFor('bar'), 'bar', 'blues');
    const map = applyPalettePreset(defaultsFor('map'), 'map', 'set1');
    expect(bar.palettePreset).toBe('dark2');
    expect(bar.palette).toEqual(colorBrewerPalette('dark2'));
    expect(map.palettePreset).toBe('blues');
    expect(map.palette).toEqual(colorBrewerPalette('blues'));
  });

  it('정성형 색상이 부족하면 ColorBrewer 배열을 순환하고 임의 색상을 만들지 않는다', () => {
    const colors = colorBrewerPalette('accent');
    const names = Array.from({ length: 10 }, (_unused, index) => `s${index}`);
    const resolved = resolveSeriesColorMap(names, colors);
    expect(resolved.s0).toBe(colors[0]);
    expect(resolved.s7).toBe(colors[7]);
    expect(resolved.s8).toBe(colors[0]);
    expect(resolved.s9).toBe(colors[1]);
  });

  it('기존 저장 차트는 직접 지정 색상까지 ColorBrewer 기본값으로 일괄 전환한다', () => {
    const legacyBar = optionsWithDefaults('bar', {
      colorTheme: { version: 3 },
      palettePreset: 'category10',
      palette: ['#123456', '#654321'],
      colorMap: { 매출: '#123456' },
      autoColorMap: { 매출: '#654321' },
      itemColorOverrides: [{ kind: 'cartesian', seriesName: '매출', dimensions: ['서울'], occurrence: 0, color: '#ABCDEF' }],
    });
    const legacyMap = optionsWithDefaults('map', {
      colorTheme: { version: 3 },
      palettePreset: 'viridis',
      palette: ['#440154', '#FDE725'],
    });

    expect(legacyBar.palettePreset).toBe('dark2');
    expect(legacyBar.palette).toEqual(colorBrewerPalette('dark2'));
    expect(legacyBar.colorTheme).toMatchObject({ version: 4, qualitativePreset: 'dark2' });
    expect(legacyBar.colorMap).toEqual({});
    expect(legacyBar.autoColorMap).toEqual({});
    expect(legacyBar.itemColorOverrides).toEqual([]);
    expect(legacyMap.palettePreset).toBe('blues');
    expect(legacyMap.palette).toEqual(colorBrewerPalette('blues'));
  });

  it('차트군별 ColorBrewer 선택과 값 팔레트 방향을 기억한다', () => {
    const map = switchMajor(defaultsFor('bar'), 'bar', 'map').next;
    const divergingMap = applyPaletteDirection(
      applyPalettePreset(map, 'map', 'rdbu'),
      'map',
      true,
    );
    const bar = switchMajor(divergingMap, 'map', 'bar').next;
    const set1Bar = applyPalettePreset(bar, 'bar', 'set1');
    const restoredMap = switchMajor(set1Bar, 'bar', 'map').next;

    expect(restoredMap.palettePreset).toBe('rdbu');
    expect(restoredMap.palette).toEqual(colorBrewerPalette('rdbu'));
    expect(restoredMap.paletteReversed).toBe(true);
    expect(restoredMap.colorTheme).toMatchObject({
      version: 4,
      qualitativePreset: 'set1',
      divergingPreset: 'rdbu',
      valueFamily: 'diverging',
      valueReversed: true,
    });
  });
});
