import { describe, expect, it } from 'vitest';
import { MAJOR_TYPES, MAJOR_TYPE_CHOICES } from '@chartsdk/chart-options';
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
});
