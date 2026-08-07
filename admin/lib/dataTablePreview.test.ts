import { describe, expect, it } from 'vitest';
import type { QueryResult } from '@/lib/api';
import {
  DATA_TABLE_PREVIEW_LIMIT,
  dataTablePreviewRows,
  dataTablePreviewSummary,
} from './dataTablePreview';

function result(rowCount: number, options: Partial<QueryResult> = {}): QueryResult {
  return {
    columns: [{ name: 'value', type: 'number' }],
    rows: Array.from({ length: rowCount }, (_, index) => [index]),
    rowCount,
    truncated: false,
    elapsedMs: 10,
    ...options,
  };
}

describe('dataTablePreviewSummary', () => {
  it('실행 결과 전체 수는 유지하고 하단 표만 1,000행으로 제한한다', () => {
    const data = result(1_205);

    expect(dataTablePreviewSummary(data, 'result')).toEqual({
      totalRowCount: 1_205,
      totalRowCountEstimated: false,
      visibleRowCount: 1_000,
      limited: true,
    });
    expect(dataTablePreviewRows(data.rows)).toHaveLength(DATA_TABLE_PREVIEW_LIMIT);
  });

  it('원본 데이터는 스키마 통계 행 수를 추정값으로 표시한다', () => {
    const data = result(1_000, { truncated: true });

    expect(dataTablePreviewSummary(data, 'raw', 500_000_000)).toEqual({
      totalRowCount: 500_000_000,
      totalRowCountEstimated: true,
      visibleRowCount: 1_000,
      limited: true,
    });
  });

  it('제한되지 않은 원본 데이터는 실제 수를 표시한다', () => {
    expect(dataTablePreviewSummary(result(12), 'raw')).toEqual({
      totalRowCount: 12,
      totalRowCountEstimated: false,
      visibleRowCount: 12,
      limited: false,
    });
  });

  it('원본 전체 수를 모르면 최소 행 수만 알 수 있게 한다', () => {
    expect(dataTablePreviewSummary(result(1_000, { truncated: true }), 'raw')).toMatchObject({
      totalRowCount: null,
      visibleRowCount: 1_000,
      limited: true,
    });
  });

  it('서버에서 잘린 실행 결과를 전체 1,000행으로 오인하지 않는다', () => {
    expect(dataTablePreviewSummary(result(1_000, { truncated: true }), 'result')).toMatchObject({
      totalRowCount: null,
      visibleRowCount: 1_000,
      limited: true,
    });
  });
});
