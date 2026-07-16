'use client';

import type { QueryResult } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  confidenceBadgeText,
  normalizeSampling,
  samplingMethodLabel,
  samplingWarningMessage,
  type SamplingEstimate,
} from '@chartsdk/chart-options/sampling';
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
  const sampling = active ? normalizeSampling(active) : undefined;

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
        {sampling && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary" data-testid="sample-badge">
            {sampling.approximate
              ? [
                  `${samplingMethodLabel(sampling.method)}${sampling.sampledRowCount !== undefined ? ` ${sampling.sampledRowCount.toLocaleString()}행` : ''}`,
                  '표본 결과',
                  confidenceBadgeText(sampling),
                ].filter(Boolean).join(' · ')
              : '정확한 전체 데이터'}
          </span>
        )}
      </div>

      {sampling?.approximate && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-5 text-amber-900">
          {sampling.estimates && sampling.estimates.length > 0 && (
            <p>{sampling.estimates.map((estimate) => `${estimate.series}: ${treatmentLabel(estimate)}`).join(' · ')}</p>
          )}
          {(sampling.warnings ?? []).map((warning) => <p key={warning}>주의: {samplingWarningMessage(warning)}</p>)}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {running ? (
          <p className="p-4 text-[13px] text-text-secondary">쿼리 실행 중… (타임아웃 10초)</p>
        ) : error ? (
          <p className="p-4 text-[13px] text-danger">{error}</p>
        ) : active ? (
          <DataTable data={active} sampleGroups={sampling?.approximate ? sampling.groups : undefined} />
        ) : (
          <p className="p-4 text-[13px] text-text-tertiary">
            {tab === 'result' ? '구성 후 [실행]을 누르면 집계 결과가 표시됩니다.' : '테이블을 선택하면 원본 데이터가 표시됩니다.'}
          </p>
        )}
      </div>
    </div>
  );
}

function treatmentLabel(estimate: Pick<SamplingEstimate, 'aggregate' | 'treatment'>): string {
  switch (estimate.treatment) {
    case 'SAMPLE_AGGREGATE': return estimate.aggregate === 'count' ? '표본 개수' : '표본 합계';
    case 'EXTRAPOLATED_TOTAL': return '이전 계약의 전체 합계 추정';
    case 'SAMPLE_ESTIMATE': return '표본 통계 추정';
    case 'OBSERVED_EXTREME': return '표본에서 관측된 극값';
    case 'OBSERVED_DISTINCT': return '표본에서 관측된 고유 개수';
    case 'EXACT': return '정확값';
  }
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
