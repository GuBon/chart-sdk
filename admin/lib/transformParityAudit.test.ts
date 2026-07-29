import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import { MAJOR_TYPES, optionsWithDefaults, type MajorType } from '@chartsdk/chart-options';
import parityContract from '@chartsdk/chart-options/transform-parity-contract-cases.json';
import { assembleOption } from '../mocks/mockTransform';
import type { QueryResult } from './api/types';

function rowsFor(chartType: MajorType): QueryResult {
  const result = (columns: QueryResult['columns'], rows: QueryResult['rows']): QueryResult => ({
    columns,
    rows,
    rowCount: rows.length,
    truncated: false,
    elapsedMs: 0,
  });
  if (chartType === 'scatter') {
    return result(
      [{ name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'size', type: 'number' }],
      [[1, 10, 3], [2, 20, 9]],
    );
  }
  if (chartType === 'boxplot') {
    return result(
      [{ name: 'category', type: 'text' }, { name: 'value', type: 'number' }],
      [['A', 1], ['A', 2], ['A', 3], ['A', 20], ['B', 4], ['B', 5], ['B', 6]],
    );
  }
  if (chartType === 'geoscatter') {
    return result(
      [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }, { name: 'size', type: 'number' }],
      [[126.978, 37.5665, 10], [129.0756, 35.1796, 30]],
    );
  }
  return result(
    [{ name: 'category', type: 'text' }, { name: 's1', type: 'number' }, { name: 's2', type: 'number' }],
    [['A', 10, 30], ['B', 20, 20]],
  );
}

describe('Java 변환기와 비교할 TypeScript 렌더 스냅샷', () => {
  it('8종 기본값과 주요 설정 조합을 생성한다', () => {
    const snapshots = {
      defaults: Object.fromEntries(MAJOR_TYPES.map((chartType) => [
        chartType,
        assembleOption(rowsFor(chartType), chartType, optionsWithDefaults(chartType)),
      ])),
      configured: Object.fromEntries(parityContract.cases.map((testCase) => {
        const dataset = parityContract.datasets[testCase.dataset as keyof typeof parityContract.datasets];
        const result: QueryResult = {
          columns: dataset.columns,
          rows: dataset.rows,
          rowCount: dataset.rows.length,
          truncated: false,
          elapsedMs: 0,
        };
        return [
          testCase.name,
          assembleOption(result, testCase.chartType as MajorType, testCase.options),
        ];
      })),
    };
    const outputDir = resolve(process.cwd(), '..', '.tmp_transform');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, 'mock.json'), JSON.stringify(snapshots, null, 2));
  });
});
