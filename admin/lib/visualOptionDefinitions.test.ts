import { describe, expect, it } from 'vitest';
import {
  MAJOR_TYPES,
  defaultsFor,
  visibleDefs,
} from '@chartsdk/chart-options';
import { visualOptionDefinitions } from './visualOptionDefinitions';

describe('visualOptionDefinitions', () => {
  it.each(MAJOR_TYPES)('%s 시각화 옵션에서 차트 종류 선택만 제외한다', (chartType) => {
    const options = defaultsFor(chartType);
    const registryKeys = visibleDefs(chartType, options).map((definition) => definition.key);
    const visualKeys = visualOptionDefinitions(chartType, options).map((definition) => definition.key);

    expect(registryKeys).toContain('chartType');
    expect(visualKeys).not.toContain('chartType');
    expect(visualKeys).not.toContain('variant');
    expect(visualKeys).toContain('title');
  });
});
