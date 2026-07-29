import { describe, expect, it } from 'vitest';
import {
  MAJOR_TYPES,
  OPTION_EDITOR_TAB_LABELS,
  defaultsFor,
  optionEditorSectionOf,
  optionEditorSectionOrder,
  optionEditorTabOf,
  optionEditorTabsFor,
  visibleDefs,
  type MajorType,
  type OptionEditorTab,
} from '@chartsdk/chart-options';
import { movingAverageOverridesSort } from '@chartsdk/chart-options/statisticalOverlays';

function visibleSections(chartType: MajorType, tab: OptionEditorTab): string[] {
  const definitions = visibleDefs(chartType, defaultsFor(chartType))
    .filter((definition) => optionEditorTabOf(definition) === tab);
  const discovered = [...new Set(definitions.map(optionEditorSectionOf))];
  const preferred = optionEditorSectionOrder(chartType, tab);
  return [
    ...preferred.filter((section) => discovered.includes(section)),
    ...discovered.filter((section) => !preferred.includes(section)),
  ];
}

describe('차트 옵션 편집 정보 구조', () => {
  it.each(MAJOR_TYPES)('%s의 모든 옵션은 노출 가능한 작업 탭에 속한다', (chartType) => {
    const tabs = optionEditorTabsFor(chartType);
    const definitions = visibleDefs(chartType, defaultsFor(chartType));

    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      const tab = optionEditorTabOf(definition);
      expect(OPTION_EDITOR_TAB_LABELS[tab]).toBeTruthy();
      expect(tabs).toContain(tab);
      expect(optionEditorSectionOf(definition)).not.toBe('');
    }
  });

  it('직교·원형·지도는 각 작업에 필요한 탭만 권장 순서로 제공한다', () => {
    expect(optionEditorTabsFor('bar')).toEqual(['basic', 'series', 'axis', 'style', 'interaction', 'data']);
    expect(optionEditorTabsFor('pie')).toEqual(['basic', 'series', 'style', 'interaction', 'data']);
    expect(optionEditorTabsFor('map')).toEqual(['basic', 'style', 'area', 'series', 'interaction', 'data']);
    expect(optionEditorTabsFor('geoscatter')).toEqual(['basic', 'style', 'area', 'interaction', 'data']);
  });

  it('계열 탭은 계열 구성·분석 표시와 라벨·정렬·범례를 제공한다', () => {
    expect(visibleSections('bar', 'series')).toEqual(['혼합', '분석 표시', '라벨 · 정렬', '범례']);
    expect(visibleSections('line', 'series')).toEqual(['혼합', '분석 표시', '라벨 · 정렬', '범례']);
    expect(visibleSections('scatter', 'series')).toEqual(['분석 표시', '라벨 · 정렬', '범례']);
    expect(visibleSections('boxplot', 'series')).toEqual(['분석 표시', '범례']);
    expect(visibleSections('pie', 'series')).toEqual(['라벨 · 정렬', '범례']);
    expect(visibleSections('geoscatter', 'series')).toEqual([]);
  });

  it('원형 라벨 위치는 전용 키 하나만 사용하고 라벨을 켰을 때만 노출한다', () => {
    const hiddenKeys = visibleDefs('pie', defaultsFor('pie'))
      .filter((definition) => definition.echarts === 'series.label.position')
      .map((definition) => definition.key);
    const enabled = { ...defaultsFor('pie'), dataLabel: true };
    const visibleKeys = visibleDefs('pie', enabled)
      .filter((definition) => definition.echarts === 'series.label.position')
      .map((definition) => definition.key);

    expect(hiddenKeys).toEqual([]);
    expect(visibleKeys).toEqual(['pie.labelPosition']);
    expect(defaultsFor('pie').labelPosition).toBeUndefined();
    expect(defaultsFor('pie').pie.labelPosition).toBe('outside');
    const position = visibleDefs('pie', enabled).find((definition) => definition.key === 'pie.labelPosition');
    expect(position && optionEditorTabOf(position)).toBe('series');
    expect(position && optionEditorSectionOf(position)).toBe('라벨 · 정렬');
  });

  it('산점도 전용 숫자축 옵션에는 현재 차트 종류를 showIf 문맥으로 전달한다', () => {
    const keys = visibleDefs('scatter', defaultsFor('scatter')).map((definition) => definition.key);

    expect(keys).toContain('xAxis.scale');
    expect(keys).toContain('xAxis.min');
    expect(keys).toContain('xAxis.max');
  });

  it('선택지가 하나뿐인 차트는 의미 없는 중분류 컨트롤을 숨긴다', () => {
    for (const chartType of ['boxplot', 'heatmap', 'map', 'geoscatter'] as const) {
      const keys = visibleDefs(chartType, defaultsFor(chartType)).map((definition) => definition.key);
      expect(keys).not.toContain('variant');
    }
    for (const chartType of ['bar', 'line', 'pie', 'scatter'] as const) {
      const keys = visibleDefs(chartType, defaultsFor(chartType)).map((definition) => definition.key);
      expect(keys).toContain('variant');
    }
  });

  it('스타일 탭은 테마 명칭을 유지하며 색상과 차트 고유 외형을 함께 제공한다', () => {
    expect(visibleSections('bar', 'style')).toEqual(['색상', '막대', '크기', '글꼴']);
    expect(visibleSections('pie', 'style')).toEqual(['색상', '원형', '크기', '글꼴']);
    expect(visibleSections('map', 'style')).toEqual(['색상', '크기', '글꼴']);
    expect(visibleSections('geoscatter', 'style')).toEqual(['색상', '점', '크기', '글꼴']);

    const theme = visibleDefs('map', defaultsFor('map')).find((definition) => definition.key === 'palettePreset');
    expect(theme?.label).toBe('테마');
    expect(theme && optionEditorTabOf(theme)).toBe('style');
  });

  it('지도 영역과 상호작용의 고급 모양 설정을 별도 섹션으로 분리한다', () => {
    expect(visibleSections('map', 'area')).toEqual(['표시 영역']);
    expect(visibleSections('bar', 'interaction')).toEqual(['툴팁', '툴팁 모양', '강조']);
    expect(visibleSections('pie', 'interaction')).toEqual(['툴팁', '툴팁 모양', '강조']);

    const areaKeys = visibleDefs('map', defaultsFor('map'))
      .filter((definition) => optionEditorTabOf(definition) === 'area')
      .map((definition) => definition.key);
    expect(areaKeys).toEqual(['map.name', 'map.viewport', 'map.roam']);
  });

  it('요소별 글꼴·글자 크기는 그 요소를 편집하는 섹션에 있고 스타일에는 전체 크기만 남는다', () => {
    const sectionOfKey = (chartType: MajorType, key: string) => {
      const definition = visibleDefs(chartType, { ...defaultsFor(chartType), dataLabel: true })
        .find((candidate) => candidate.key === key);
      return definition && `${optionEditorTabOf(definition)}/${optionEditorSectionOf(definition)}`;
    };

    expect(sectionOfKey('bar', 'typography.titleFontSize')).toBe('basic/기본');
    expect(sectionOfKey('bar', 'typography.titleFontFamily')).toBe('basic/기본');
    expect(sectionOfKey('bar', 'typography.legendFontSize')).toBe('series/범례');
    expect(sectionOfKey('bar', 'typography.legendFontFamily')).toBe('series/범례');
    expect(sectionOfKey('bar', 'typography.dataLabelFontSize')).toBe('series/라벨 · 정렬');
    expect(sectionOfKey('bar', 'typography.dataLabelFontFamily')).toBe('series/라벨 · 정렬');
    expect(sectionOfKey('bar', 'typography.axisFontSize')).toBe('axis/축 글자');
    expect(sectionOfKey('bar', 'typography.axisFontFamily')).toBe('axis/축 글자');
    expect(sectionOfKey('bar', 'typography.tooltipFontSize')).toBe('interaction/툴팁 모양');
    expect(sectionOfKey('bar', 'typography.tooltipFontFamily')).toBe('interaction/툴팁 모양');

    const styleFontKeys = visibleDefs('bar', defaultsFor('bar'))
      .filter((definition) => optionEditorSectionOf(definition) === '글꼴')
      .map((definition) => definition.key);
    expect(styleFontKeys).toEqual(['typography.scale']);

    expect(visibleSections('bar', 'axis')).toEqual(['축 글자', '여백', 'X축', 'Y축']);
  });

  it('요소별 글꼴은 기본, 글자 크기는 자동(null)이며 폐기된 키는 남지 않는다', () => {
    for (const chartType of MAJOR_TYPES) {
      const typography = defaultsFor(chartType).typography as Record<string, unknown>;
      expect(typography.mode).toBeUndefined();
      expect(typography.fontFamily).toBeUndefined();
      expect(typography.scale).toBe(100);
      expect(typography.titleFontFamily).toBe('default');
      expect(typography.titleFontSize).toBeNull();
    }
  });
});

describe('이동평균이 정렬 선택을 무효로 만드는 조건', () => {
  const temporalColumns = [{ type: 'timestamp without time zone' }, { type: 'numeric' }];
  const categoryColumns = [{ type: 'text' }, { type: 'numeric' }];
  const enabled = { analysis: { movingAverage: { enabled: true, seriesIndex: 0, period: 3, showInLegend: true } } };

  it('시간축 선 차트에서 이동평균이 켜지면 정렬 선택을 잠근다', () => {
    expect(movingAverageOverridesSort('line', enabled, temporalColumns)).toBe(true);
  });

  it('시간축이 아니거나 선 차트가 아니면 잠그지 않는다', () => {
    expect(movingAverageOverridesSort('line', enabled, categoryColumns)).toBe(false);
    expect(movingAverageOverridesSort('bar', enabled, temporalColumns)).toBe(false);
    expect(movingAverageOverridesSort('line', enabled, [])).toBe(false);
  });

  it('이동평균을 끄면 저장된 정렬값을 그대로 둔 채 다시 열린다', () => {
    const options: Record<string, unknown> = {
      sortOrder: 'desc',
      analysis: { movingAverage: { ...enabled.analysis.movingAverage } },
    };
    expect(movingAverageOverridesSort('line', options, temporalColumns)).toBe(true);

    // 잠금은 표시 상태일 뿐이라 저장 옵션을 건드리지 않는다 — 토글만 꺼도 이전 정렬이 되살아난다.
    const reopened: Record<string, unknown> = {
      ...options,
      analysis: { movingAverage: { ...enabled.analysis.movingAverage, enabled: false } },
    };
    expect(movingAverageOverridesSort('line', reopened, temporalColumns)).toBe(false);
    expect(reopened.sortOrder).toBe('desc');
  });

  it('저장 JSON이 손상돼도 잠금 판정에서 예외를 내지 않는다', () => {
    expect(movingAverageOverridesSort('line', null, temporalColumns)).toBe(false);
    expect(movingAverageOverridesSort('line', { analysis: 'broken' }, temporalColumns)).toBe(false);
    expect(movingAverageOverridesSort('line', enabled, null)).toBe(false);
  });
});
