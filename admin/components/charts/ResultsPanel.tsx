'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { QueryResult } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dataTablePreviewSummary } from '@/lib/dataTablePreview';
import {
  flexRowMinimumWidth,
  RESULTS_HEADER_FLEXIBLE_ITEM_MIN_WIDTH,
} from '@/lib/chartEditorLayout';
import {
  confidenceBadgeText,
  normalizeSampling,
  samplingMethodLabel,
  samplingWarningMessage,
  type SamplingEstimate,
} from '@chartsdk/chart-options/sampling';
import { DataTable } from './DataTable';

// S2 하단 결과 영역: [원본 데이터](선택 테이블) / [실행 결과](차트·조회) 탭 + "N행 · Nms".
export type ResultTab = 'result' | 'raw';

interface Props {
  result: QueryResult | null;
  raw: QueryResult | null;
  tab: ResultTab;
  onTab: (t: ResultTab) => void;
  running: boolean;
  error: string | null;
  rawTableLabel: string | null;
  estimatedOriginalRowCount?: number | null;
  onMinimumWidthChange?: (width: number) => void;
}

export function ResultsPanel({
  result,
  raw,
  tab,
  onTab,
  running,
  error,
  rawTableLabel,
  estimatedOriginalRowCount,
  onMinimumWidthChange,
}: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const active = tab === 'result' ? result : raw;
  const sampling = active ? normalizeSampling(active) : undefined;
  const previewSummary = active
    ? dataTablePreviewSummary(active, tab, estimatedOriginalRowCount)
    : null;

  const reportMinimumWidth = useCallback(() => {
    const header = headerRef.current;
    if (!header || !onMinimumWidthChange) return;

    const styles = window.getComputedStyle(header);
    const itemWidths = Array.from(header.children, (child) => {
      const element = child as HTMLElement;
      const intrinsicWidth = Math.max(element.scrollWidth, element.getBoundingClientRect().width);
      return element.dataset.minimumWidth === 'flexible'
        ? Math.min(intrinsicWidth, RESULTS_HEADER_FLEXIBLE_ITEM_MIN_WIDTH)
        : intrinsicWidth;
    });

    onMinimumWidthChange(flexRowMinimumWidth({
      itemWidths,
      gap: Number.parseFloat(styles.columnGap) || 0,
      paddingStart: Number.parseFloat(styles.paddingInlineStart) || 0,
      paddingEnd: Number.parseFloat(styles.paddingInlineEnd) || 0,
    }));
  }, [onMinimumWidthChange]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || !onMinimumWidthChange) return;

    reportMinimumWidth();
    const resizeObserver = new ResizeObserver(reportMinimumWidth);
    resizeObserver.observe(header);
    Array.from(header.children).forEach((child) => resizeObserver.observe(child));

    const mutationObserver = new MutationObserver(reportMinimumWidth);
    mutationObserver.observe(header, { childList: true, characterData: true, subtree: true });

    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) reportMinimumWidth();
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [onMinimumWidthChange, reportMinimumWidth]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={headerRef}
        data-testid="results-panel-header"
        className="flex h-[52px] shrink-0 items-center gap-3 overflow-hidden border-b border-border px-4"
      >
        <div data-minimum-width="fixed" className="flex shrink-0 gap-1 whitespace-nowrap rounded-md bg-muted p-0.5">
          <Tab label="원본 데이터" active={tab === 'raw'} onClick={() => onTab('raw')} />
          <Tab label="실행 결과" active={tab === 'result'} onClick={() => onTab('result')} />
        </div>
        {tab === 'raw' && rawTableLabel && (
          <span
            data-minimum-width="flexible"
            className="min-w-0 truncate whitespace-nowrap text-xs font-bold text-text-secondary"
            title={rawTableLabel}
          >
            {rawTableLabel}
          </span>
        )}
        {active && previewSummary && (
          <span
            data-minimum-width="fixed"
            className="ml-auto shrink-0 whitespace-nowrap text-xs text-text-tertiary"
            data-testid="result-count-summary"
          >
            {tab === 'raw' ? '원본 전체 ' : '실행 전체 '}
            {previewSummary.totalRowCount === null
              ? `${active.rowCount.toLocaleString()}행 이상`
              : `${previewSummary.totalRowCountEstimated ? '약 ' : ''}${previewSummary.totalRowCount.toLocaleString()}행`}
            {' · 미리보기 '}{previewSummary.visibleRowCount.toLocaleString()}행
            {' · '}{active.elapsedMs.toLocaleString()}ms
          </span>
        )}
        {sampling && (
          <span
            data-minimum-width="fixed"
            className="shrink-0 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary"
            data-testid="sample-badge"
          >
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
            {tab === 'result'
              ? '차트 구성을 완성한 뒤 [실행]을 누르세요.'
              : '왼쪽 데이터 패널에서 테이블을 선택하면 원본 데이터가 표시됩니다.'}
          </p>
        )}
      </div>
    </div>
  );
}

function treatmentLabel(estimate: Pick<SamplingEstimate, 'aggregate' | 'treatment'>): string {
  switch (estimate.treatment) {
    case 'ROW_SAMPLE': return '표본 원본값';
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
        'shrink-0 whitespace-nowrap rounded px-3 py-1 text-[13px] transition-colors',
        active ? 'bg-bg-panel font-medium text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
      )}
    >
      {label}
    </button>
  );
}
