import type { QueryResult } from '@/lib/api';
import { dataTablePreviewRows, DATA_TABLE_PREVIEW_LIMIT } from '@/lib/dataTablePreview';
import type { SamplingGroupCount } from '@chartsdk/chart-options/sampling';

// 차트 데이터는 건드리지 않고, 결과/원본 데이터 하단 표에만 최대 행 수를 적용한다.
export function DataTable({ data, sampleGroups }: { data: QueryResult; sampleGroups?: SamplingGroupCount[] }) {
  const sampleCountByKey = new Map(sampleGroups?.map((group) => [String(group.key ?? ''), group.sampleCount]));
  const showSampleCount = sampleCountByKey.size > 0;
  const previewRows = dataTablePreviewRows(data.rows);
  const limited = data.truncated || data.rows.length > DATA_TABLE_PREVIEW_LIMIT;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-muted/60">
            <tr>
              {data.columns.map((c, i) => (
                <th key={i} className="border-b border-border px-4 py-2 text-left font-medium text-text-secondary">
                  <span className="block">{c.displayName || c.name}</span>
                  {c.displayName && c.displayName !== c.name && (
                    <span className="block font-mono text-[10px] font-normal text-text-tertiary">{c.name}</span>
                  )}
                </th>
              ))}
              {showSampleCount && (
                <th className="border-b border-border px-4 py-2 text-left font-medium text-text-secondary">
                  표본 입력 행
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i} className="border-b border-border">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-text-primary">
                    {String(cell)}
                  </td>
                ))}
                {showSampleCount && (
                  <td className="px-4 py-2 text-text-secondary">
                    {sampleCountByKey.get(String(row[0] ?? ''))?.toLocaleString() ?? '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limited && (
        <p className="border-t border-border px-4 py-2 text-xs text-text-tertiary">
          하단 표는 최대 {DATA_TABLE_PREVIEW_LIMIT.toLocaleString()}행까지 표시합니다.
        </p>
      )}
    </div>
  );
}
