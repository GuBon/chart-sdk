import type { QueryResult } from '@/lib/api';
import type { SamplingGroupCount } from '@chartsdk/chart-options/sampling';

// 결과/원본 데이터 공통 표(258:232). 원본 미리보기가 제한된 경우에만 1,000행 안내를 표시한다.
export function DataTable({ data, sampleGroups }: { data: QueryResult; sampleGroups?: SamplingGroupCount[] }) {
  const sampleCountByKey = new Map(sampleGroups?.map((group) => [String(group.key ?? ''), group.sampleCount]));
  const showSampleCount = sampleCountByKey.size > 0;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 bg-muted/60">
            <tr>
              {data.columns.map((c, i) => (
                <th key={i} className="border-b border-border px-4 py-2 text-left font-medium text-text-secondary">
                  {c.name}
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
            {data.rows.map((row, i) => (
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
      {data.truncated && <p className="border-t border-border px-4 py-2 text-xs text-text-tertiary">1,000행까지 표시</p>}
    </div>
  );
}
