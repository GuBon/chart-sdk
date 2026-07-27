import { describe, expect, it } from 'vitest';
import {
  findItemColorOverride,
  itemColorTargetKey,
  normalizeItemColorOverrides,
  removeItemColorOverride,
  upsertItemColorOverride,
  type ItemColorTarget,
} from '@chartsdk/chart-options/colorOverrides';

const target: ItemColorTarget = {
  kind: 'cartesian',
  seriesName: '매출',
  dimensions: ['서울'],
  occurrence: 0,
};

describe('item color overrides', () => {
  it('동일 항목 색상을 중복 없이 갱신한다', () => {
    const first = upsertItemColorOverride([], target, '#abc');
    const second = upsertItemColorOverride(first, target, '#123456');

    expect(second).toEqual([{
      ...target,
      color: '#123456',
    }]);
  });

  it('항목 색상을 제거한다', () => {
    const overrides = upsertItemColorOverride([], target, '#ABCDEF');

    expect(removeItemColorOverride(overrides, target)).toEqual([]);
  });

  it('잘못된 값과 중복 저장값을 정규화하고 마지막 색상을 사용한다', () => {
    expect(normalizeItemColorOverrides([
      { ...target, color: '#111111' },
      { ...target, color: '#222222' },
      { ...target, color: 'red' },
      null,
    ])).toEqual([{ ...target, color: '#222222' }]);
  });

  it('숫자 -0과 0을 같은 키로 처리하고 occurrence는 구분한다', () => {
    const base: ItemColorTarget = { kind: 'scatter', seriesName: '값', dimensions: [-0], occurrence: 0 };
    const duplicate: ItemColorTarget = { ...base, dimensions: [0], occurrence: 1 };

    expect(itemColorTargetKey(base)).toBe(itemColorTargetKey({ ...base, dimensions: [0] }));
    expect(itemColorTargetKey(base)).not.toBe(itemColorTargetKey(duplicate));
  });

  it('저장된 항목을 의미 키로 조회한다', () => {
    const overrides = upsertItemColorOverride([], target, '#FEDCBA');

    expect(findItemColorOverride(overrides, { ...target })).toMatchObject({ color: '#FEDCBA' });
  });
});
