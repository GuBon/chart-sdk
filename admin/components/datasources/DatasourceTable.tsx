import Link from 'next/link';
import type { Datasource } from '@/lib/api';
import { chartDatasourcePath } from '@/lib/chartRoutes';
import { Button } from '@/components/ui/Button';
import { StatusDot } from './StatusDot';

// Figma S5 목록 테이블(275:434). 표시 전용 — 동작은 콜백으로 위임.
interface Props {
  datasources: Datasource[];
  testingId: number | null;
  onTest: (ds: Datasource) => void;
  onEdit: (ds: Datasource) => void;
  onDelete: (ds: Datasource) => void;
}

const TH = 'px-0 text-left text-xs font-medium text-text-secondary';

export function DatasourceTable({ datasources, testingId, onTest, onEdit, onDelete }: Props) {
  return (
    <div className="w-full overflow-hidden rounded-[10px] border border-border bg-bg-panel">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[220px]" />
          <col className="w-[280px]" />
          <col className="w-[200px]" />
          <col className="w-[130px]" />
          <col className="w-[130px]" />
          <col className="w-[140px]" />
        </colgroup>
        <thead>
          <tr className="h-10 bg-muted/60">
            <th className={`${TH} pl-5`}>이름</th>
            <th className={TH}>호스트 : 포트</th>
            <th className={TH}>데이터베이스</th>
            <th className={TH}>상태</th>
            <th className={TH}>연결</th>
            <th className={`${TH} pr-5`}>작업</th>
          </tr>
        </thead>
        <tbody>
          {datasources.map((ds) => (
            <tr key={ds.id} className="h-[52px] border-t border-border">
              <td className="truncate pl-5 text-[13px] font-medium" title={ds.name}>
                <Link href={`${chartDatasourcePath(ds.name)}?view=schema`} className="text-text-primary hover:text-primary hover:underline">{ds.name}</Link>
              </td>
              <td className="truncate text-[13px] text-text-secondary" title={`${ds.host} : ${ds.port}`}>
                {ds.host} : {ds.port}
              </td>
              <td className="truncate text-[13px] text-text-secondary" title={ds.databaseName}>{ds.databaseName}</td>
              <td>
                <StatusDot ok={ds.lastTestOk} />
              </td>
              <td>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-[7px] text-xs"
                  disabled={testingId === ds.id}
                  onClick={() => onTest(ds)}
                >
                  {testingId === ds.id ? '테스트 중…' : '연결 테스트'}
                </Button>
              </td>
              <td className="pr-5 text-xs">
                <button type="button" className="font-medium text-text-secondary hover:text-text-primary" onClick={() => onEdit(ds)}>
                  수정
                </button>
                <span className="px-1.5 text-text-secondary">·</span>
                <button type="button" className="font-medium text-danger hover:opacity-80" onClick={() => onDelete(ds)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
