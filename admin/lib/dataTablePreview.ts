import type { QueryResult } from '@/lib/api';

export const DATA_TABLE_PREVIEW_LIMIT = 1_000;

export interface DataTablePreviewSummary {
  totalRowCount: number | null;
  totalRowCountEstimated: boolean;
  visibleRowCount: number;
  limited: boolean;
}

/**
 * 하단 표에만 적용되는 표시 규칙을 계산한다.
 * 실행 결과의 rowCount는 차트에 전달된 전체 결과 수이고, 원본 데이터는
 * 대용량 COUNT(*) 대신 스키마 통계의 추정 행 수를 사용할 수 있다.
 */
export function dataTablePreviewSummary(
  data: QueryResult,
  kind: 'result' | 'raw',
  estimatedOriginalRowCount?: number | null,
): DataTablePreviewSummary {
  const visibleRowCount = Math.min(data.rows.length, DATA_TABLE_PREVIEW_LIMIT);
  const limited = data.truncated || data.rows.length > DATA_TABLE_PREVIEW_LIMIT;

  if (kind === 'result' && !data.truncated) {
    return {
      totalRowCount: data.rowCount,
      totalRowCountEstimated: false,
      visibleRowCount,
      limited,
    };
  }

  if (Number.isFinite(estimatedOriginalRowCount) && Number(estimatedOriginalRowCount) >= 0) {
    return {
      totalRowCount: Math.max(data.rowCount, Number(estimatedOriginalRowCount)),
      totalRowCountEstimated: true,
      visibleRowCount,
      limited,
    };
  }

  return {
    totalRowCount: limited ? null : data.rowCount,
    totalRowCountEstimated: false,
    visibleRowCount,
    limited,
  };
}

export function dataTablePreviewRows(rows: unknown[][]): unknown[][] {
  return rows.slice(0, DATA_TABLE_PREVIEW_LIMIT);
}
