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
    expect(optionEditorTabsFor('map')).toEqual(['basic', 'area', 'series', 'style', 'interaction', 'data']);
    expect(optionEditorTabsFor('geoscatter')).toEqual(['basic', 'area', 'series', 'style', 'interaction', 'data']);
  });

  it('계열 탭은 차트 고유 설정을 색상·라벨·범례보다 먼저 둔다', () => {
    expect(visibleSections('bar', 'series')).toEqual(['막대', '혼합', '색상', '라벨 · 정렬', '범례']);
    expect(visibleSections('line', 'series')).toEqual(['선', '혼합', '색상', '라벨 · 정렬', '범례']);
    expect(visibleSections('pie', 'series')).toEqual(['원형', '색상', '라벨 · 정렬', '범례']);
    expect(visibleSections('geoscatter', 'series')).toEqual(['점', '색상']);
  });

  it('지도 영역과 상호작용의 고급 모양 설정을 별도 섹션으로 분리한다', () => {
    expect(visibleSections('map', 'area')).toEqual(['표시 영역']);
    expect(visibleSections('bar', 'interaction')).toEqual(['툴팁', '툴팁 모양', '강조']);
  });
});
