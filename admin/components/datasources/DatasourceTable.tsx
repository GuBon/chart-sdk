import { Fragment } from 'react';
import Link from 'next/link';
import type { Datasource } from '@/lib/api';
import { chartDatasourcePath } from '@/lib/chartRoutes';
import { Button } from '@/components/ui/Button';
import { StatusDot } from './StatusDot';

// Figma S5 목록 테이블(275:434). 표시 전용 — 동작은 콜백으로 위임.
interface Props {
  datasources: Datasource[];
  testingId: number | null;
  /** 마지막 연결 테스트 결과 — 해당 데이터소스 행 바로 아래에 성공/실패 사유를 표시한다. */
  testResult?: { datasourceId: number; ok: boolean; message: string } | null;
  onTest: (ds: Datasource) => void;
  onEdit: (ds: Datasource) => void;
  onDelete: (ds: Datasource) => void;
}

const TH = 'px-0 text-left text-xs font-medium text-text-secondary';

export function DatasourceTable({ datasources, testingId, testResult, onTest, onEdit, onDelete }: Props) {
  // 실 DB 동시 접속을 피하려 하나가 진행 중이면 모든 연결 테스트 버튼을 비활성화한다.
  const testing = testingId != null;
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
            <Fragment key={ds.id}>
              <tr className="h-[52px] border-t border-border">
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
                    disabled={testing}
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
              {testResult?.datasourceId === ds.id && (
                <tr className="border-t border-border/60">
                  <td colSpan={6} className="px-5 py-2">
                    <p
                      role={testResult.ok ? 'status' : 'alert'}
                      className={`text-[13px] ${testResult.ok ? 'text-success' : 'text-danger'}`}
                    >
                      {testResult.message}
                    </p>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
