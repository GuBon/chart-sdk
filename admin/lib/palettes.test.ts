import { describe, expect, it } from 'vitest';
import { defaultsFor, optionsWithDefaults, switchMajor, type MajorType } from '@chartsdk/chart-options';
import {
  CARTO_QUALITATIVE,
  CARTO_SEQUENTIAL,
  applyPalettePreset,
  applySequentialPaletteDirection,
  cartoPalette,
  paletteChoicesForChartType,
  paletteFamilyForChartType,
  resolveSeriesColorMap,
} from '@chartsdk/chart-options/palettes';

describe('CARTO 정성형 팔레트 계약', () => {
  it('모든 테마가 공식 12색 구성을 유지한다', () => {
    for (const palette of Object.values(CARTO_QUALITATIVE)) {
      expect(palette).toHaveLength(12);
    }
  });

  it('Pastel의 마지막 확장 색상까지 공식 순서로 제공한다', () => {
    expect(cartoPalette('pastel')).toEqual([
      '#66C5CC', '#F6CF71', '#F89C74', '#DCB0F2',
      '#87C55F', '#9EB9F3', '#FE88B1', '#C9DB74',
      '#8BE0A4', '#B497E7', '#D3B484', '#B3B3B3',
    ]);
  });
});

describe('차트 대분류별 CARTO 팔레트 정책', () => {
  it('영역 지도·행렬 히트맵만 순차형이고 나머지는 범주형이다', () => {
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
    expect(barChoices).toHaveLength(25);
    expect(mapChoices).toHaveLength(25);
    expect(new Set(barChoices.slice(0, 6).map((choice) => choice.value))).toEqual(new Set(Object.keys(CARTO_QUALITATIVE)));
    expect(new Set(mapChoices.slice(0, 19).map((choice) => choice.value))).toEqual(new Set(Object.keys(CARTO_SEQUENTIAL)));
    expect(new Set(barChoices.map((choice) => choice.value))).toEqual(new Set(mapChoices.map((choice) => choice.value)));
  });

  it('편집기 테마 이름에는 CARTO 접두어를 노출하지 않는다', () => {
    const labels = [
      ...paletteChoicesForChartType('bar'),
      ...paletteChoicesForChartType('map'),
    ].map((choice) => choice.label);
    expect(labels).not.toContain('CARTO');
    expect(labels.every((label) => !label.startsWith('CARTO '))).toBe(true);
  });

  it('공식 순차형 19개를 7단계로 제공하고 Teal 순서를 유지한다', () => {
    expect(Object.keys(CARTO_SEQUENTIAL)).toEqual([
      'burg', 'burgyl', 'redor', 'oryel', 'peach', 'pinkyl', 'mint', 'blugrn', 'darkmint',
      'emrld', 'bluyl', 'teal', 'tealgrn', 'purp', 'purpor', 'sunset', 'magenta',
      'sunsetdark', 'brwnyl',
    ]);
    for (const palette of Object.values(CARTO_SEQUENTIAL)) expect(palette).toHaveLength(7);
    expect(cartoPalette('teal')).toEqual([
      '#D1EEEA', '#A8DBD9', '#85C4C9', '#68ABB8', '#4F90A6', '#3B738F', '#2A5674',
    ]);
  });

  it('차트 권장 계열과 다른 테마도 선택하면 그대로 적용하고 계열별 선택을 기억한다', () => {
    const sequentialBar = applyPalettePreset(defaultsFor('bar'), 'bar', 'burg');
    expect(sequentialBar.palettePreset).toBe('burg');
    expect(sequentialBar.palette).toEqual(cartoPalette('burg'));
    expect(sequentialBar.paletteReversed).toBe(false);
    expect(sequentialBar.colorTheme).toMatchObject({ sequentialPreset: 'burg' });

    const qualitativeMap = applyPalettePreset(defaultsFor('map'), 'map', 'bold');
    expect(qualitativeMap.palettePreset).toBe('bold');
    expect(qualitativeMap.palette).toEqual(cartoPalette('bold'));
    expect(qualitativeMap.paletteReversed).toBe(false);
    expect(qualitativeMap.colorTheme).toMatchObject({ qualitativePreset: 'bold' });
  });

  it('순차형 테마는 시리즈 수가 팔레트 단계보다 적거나 많아도 전체 그라데이션에 고르게 배정한다', () => {
    const teal = cartoPalette('teal');
    expect(resolveSeriesColorMap(['s1', 's2', 's3'], teal, {}, true)).toEqual({
      s1: teal[0],
      s2: teal[3],
      s3: teal[6],
    });

    const names = Array.from({ length: 10 }, (_unused, index) => `s${index}`);
    const spread = resolveSeriesColorMap(names, ['#000000', '#FFFFFF'], { s0: '#FF0000' }, true);
    expect(Object.keys(spread)).toHaveLength(10);
    expect(spread.s0).toBe('#000000');
    expect(spread.s5).toBe('#8E8E8E');
    expect(spread.s9).toBe('#FFFFFF');
    expect(new Set(Object.values(spread)).size).toBe(10);
  });

  it('새 지도 기본값은 Teal이고 구 저장 지도는 이전 팔레트 계약을 표시한다', () => {
    const fresh = defaultsFor('map');
    expect(fresh.palettePreset).toBe('teal');
    expect(fresh.palette).toEqual(cartoPalette('teal'));
    expect(fresh.colorTheme).toMatchObject({ version: 2, sequentialPreset: 'teal' });

    const legacy = optionsWithDefaults('map', { palettePreset: 'safe', palette: cartoPalette('safe') });
    expect(legacy.colorTheme).toBeUndefined();
    expect(legacy.palettePreset).toBe('safe');
    expect(legacy.palette).toEqual(cartoPalette('safe'));
  });

  it('구 저장 지도는 같은 순차형 계열 전환만으로 새 계약으로 바뀌지 않는다', () => {
    const legacyMap = optionsWithDefaults('map', {
      palettePreset: 'safe',
      palette: cartoPalette('safe'),
    });
    const legacyHeatmap = switchMajor(legacyMap, 'map', 'heatmap').next;
    expect(legacyHeatmap.colorTheme).toBeUndefined();
    expect(legacyHeatmap.palette).toEqual(cartoPalette('safe'));

    const reversed = applySequentialPaletteDirection(legacyMap, 'map', true);
    expect(reversed.colorTheme).toMatchObject({ version: 2, sequentialPreset: 'teal', sequentialReversed: true });
    expect(reversed.palettePreset).toBe('teal');
    expect(reversed.palette).toEqual(cartoPalette('teal'));
  });

  it('분류별 마지막 테마와 순차형 방향을 기억하며 직접 지정 색상은 보존한다', () => {
    const map = switchMajor(defaultsFor('bar'), 'bar', 'map').next;
    const burg = applySequentialPaletteDirection(
      applyPalettePreset({
        ...map,
        colorMap: { 매출: '#123456' },
        itemColorOverrides: [{ kind: 'map', seriesName: '__map__', dimensions: ['서울'], occurrence: 0, color: '#654321' }],
      }, 'map', 'burg'),
      'map',
      true,
    );
    const bar = switchMajor(burg, 'map', 'bar').next;
    const bold = applyPalettePreset(bar, 'bar', 'bold');
    const restoredMap = switchMajor(bold, 'bar', 'map').next;

    expect(restoredMap.palettePreset).toBe('burg');
    expect(restoredMap.palette).toEqual(cartoPalette('burg'));
    expect(restoredMap.paletteReversed).toBe(true);
    expect(restoredMap.colorTheme).toMatchObject({
      qualitativePreset: 'bold',
      sequentialPreset: 'burg',
      sequentialReversed: true,
    });
    expect(restoredMap.colorMap).toEqual({ 매출: '#123456' });
    expect(restoredMap.itemColorOverrides).toHaveLength(1);
  });
});
