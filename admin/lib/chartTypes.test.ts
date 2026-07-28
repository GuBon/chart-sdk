import { describe, expect, it } from 'vitest';
import { MAJOR_TYPES, MAJOR_TYPE_CHOICES, OPTION_REGISTRY } from '@chartsdk/chart-options';
import { CHART_TYPE_FILTER_OPTIONS, CHART_TYPE_META, chartTypeLabel } from './chartTypes';

describe('chart type presentation metadata', () => {
  it('레지스트리의 모든 대분류에 표시 이름과 아이콘을 한 번씩 제공한다', () => {
    expect(Object.keys(CHART_TYPE_META)).toEqual(MAJOR_TYPES);
    for (const choice of MAJOR_TYPE_CHOICES) {
      expect(chartTypeLabel(choice.value)).toBe(choice.label);
      expect(CHART_TYPE_META[choice.value].Icon).toBeTypeOf('object');
    }
  });

  it('목록 필터는 전체 항목 뒤에 레지스트리 순서를 그대로 사용한다', () => {
    expect(CHART_TYPE_FILTER_OPTIONS).toEqual([
      { value: 'all', label: '모든 종류' },
      ...MAJOR_TYPE_CHOICES.map(({ value, label }) => ({ value, label })),
    ]);
  });

  it('차트 유형과 데이터 갱신 설정에 사용자 용어를 일관되게 사용한다', () => {
    expect(MAJOR_TYPE_CHOICES).toEqual([
      { value: 'bar', label: '막대' },
      { value: 'line', label: '선' },
      { value: 'pie', label: '원형' },
      { value: 'scatter', label: '산점도' },
      { value: 'boxplot', label: '박스 플롯' },
      { value: 'heatmap', label: '행렬 히트맵' },
      { value: 'map', label: '영역 지도', group: 'GEO' },
      { value: 'geoscatter', label: '포인트 지도', group: 'GEO' },
    ]);

    const refreshMode = OPTION_REGISTRY.find((definition) => definition.key === 'refreshMode');
    expect(refreshMode?.choices).toEqual([
      { value: 'live', label: '항상 최신 조회' },
      { value: 'ttl', label: '캐시 사용' },
      { value: 'manual', label: '수동' },
    ]);
    expect(OPTION_REGISTRY.find((definition) => definition.key === 'cacheTtlSeconds')?.label)
      .toBe('캐시 유효 시간');
    expect(OPTION_REGISTRY.find((definition) => definition.key === 'line.areaOpacity')?.label)
      .toBe('영역 불투명도');
  });
});
