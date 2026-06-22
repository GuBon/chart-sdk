'use client';

import type { QueryResult } from '@/lib/api';
import { cn } from '@/lib/cn';
import { DataTable } from './DataTable';

// S2 하단 결과 영역(258:228): [실행 결과](집계) / [원본 데이터](raw) 탭 + "N행 · Nms".
export type ResultTab = 'result' | 'raw';

interface Props {
  result: QueryResult | null;
  raw: QueryResult | null;
  tab: ResultTab;
  onTab: (t: ResultTab) => void;
  running: boolean;
  error: string | null;
}

export function ResultsPanel({ result, raw, tab, onTab, running, error }: Props) {
  const active = tab === 'result' ? result : raw;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex gap-1 rounded-md bg-muted p-0.5">
          <Tab label="실행 결과" active={tab === 'result'} onClick={() => onTab('result')} />
          <Tab label="원본 데이터" active={tab === 'raw'} onClick={() => onTab('raw')} />
        </div>
        {active && (
          <span className="text-xs text-text-tertiary">
            {active.rowCount}행 · {active.elapsedMs}ms
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {running ? (
          <p className="p-4 text-[13px] text-text-secondary">쿼리 실행 중… (타임아웃 10초)</p>
        ) : error ? (
          <p className="p-4 text-[13px] text-danger">{error}</p>
        ) : active ? (
          <DataTable data={active} />
        ) : (
          <p className="p-4 text-[13px] text-text-tertiary">
            {tab === 'result' ? '구성 후 [실행]을 누르면 집계 결과가 표시됩니다.' : '테이블을 선택하면 원본 데이터가 표시됩니다.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1 text-[13px] transition-colors',
        active ? 'bg-bg-panel font-medium text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
