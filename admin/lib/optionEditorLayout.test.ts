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
