import type { QueryResult } from '@/lib/api';

// 결과/원본 데이터 공통 표(258:232). 세로 스크롤, 1,000행 초과 시 안내.
export function DataTable({ data }: { data: QueryResult }) {
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="border-t border-border px-4 py-2 text-xs text-text-tertiary">1,000행까지 표시</p>}
    </div>
  );
}
