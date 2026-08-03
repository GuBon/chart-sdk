'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Trash2, Triangle } from 'lucide-react';
import type { ChartOptions, ChartSummary } from '@/lib/api';
import { CHART_TYPE_META } from '@/lib/chartTypes';
import { Button } from '@/components/ui/Button';
import { chartEditPath } from '@/lib/chartRoutes';

// 목록에서는 16:9 미리보기를 우선하고, 설명·데이터 레이어·작성자는 필요할 때만 펼쳐 본다.
import { MiniChart } from './MiniChart';

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

export function ChartCard({
  chart,
  previewOption,
  onEmbed,
  onDelete,
}: {
  chart: ChartSummary;
  previewOption?: ChartOptions | null;
  onEmbed: (c: ChartSummary) => void;
  onDelete: (c: ChartSummary) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { label, Icon } = CHART_TYPE_META[chart.chartType];
  const detailsId = `chart-card-details-${chart.id}`;

  return (
    <article className={`group relative flex flex-col border border-border bg-bg-panel ${expanded ? 'z-30 rounded-t-[10px] border-b-transparent' : 'rounded-[10px]'}`}>
      <div className="flex h-[170px] shrink-0 items-center justify-center rounded-t-[9px] bg-muted p-2">
        <div data-testid="chart-preview-frame" className="aspect-video w-full max-w-[272px]">
          <MiniChart option={previewOption} />
        </div>
      </div>
      <button
        type="button"
        aria-label={`${chart.name} 삭제`}
        onClick={() => onDelete(chart)}
        className="absolute right-2 top-2 hidden rounded-md bg-bg-panel/90 p-1.5 text-text-secondary shadow-sm hover:text-danger group-hover:block"
      >
        <Trash2 className="size-3.5" />
      </button>

      <div className="flex h-[70px] shrink-0 flex-col gap-1.5 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <p data-testid="chart-card-name" className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{chart.name}</p>
          <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted pl-1.5 pr-2 text-xs font-medium text-text-primary">
            <Icon className="size-3" />
            {label}
          </span>
        </div>
        <div className="flex gap-2">
          <Link href={chartEditPath(chart.id, chart.mainTable)} className="flex-1">
            <Button variant="secondary" size="sm" className="h-7 w-full">
              편집
            </Button>
          </Link>
          <Button variant="secondary" size="sm" className="h-7 flex-1 bg-muted" onClick={() => onEmbed(chart)}>
            임베드
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          id={detailsId}
          role="region"
          aria-label={`${chart.name} 상세 정보`}
          className="absolute -left-px -right-px top-full z-30 -mt-px flex max-h-[260px] flex-col rounded-b-[10px] border-x border-b border-border bg-bg-panel"
        >
          <div className="min-h-0 overflow-y-auto px-3.5 pt-3">
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="mb-1 font-semibold text-text-primary">설명</dt>
                <dd className="whitespace-pre-wrap break-words leading-5 text-text-secondary">
                  {chart.description?.trim() || '설명이 없습니다.'}
                </dd>
              </div>

              <div>
                <dt className="mb-1.5 font-semibold text-text-primary">사용된 데이터 레이어</dt>
                <dd
                  className="truncate text-text-secondary"
                  title={`${chart.mainTable.datasourceName} · ${chart.mainTable.schema}.${chart.mainTable.name}`}
                >
                  {chart.mainTable.datasourceName} · {chart.mainTable.schema}.{chart.mainTable.name}
                </dd>
              </div>

              <div className="flex items-baseline gap-2">
                <dt className="shrink-0 font-semibold text-text-primary">작성자</dt>
                <dd className="min-w-0 truncate text-text-secondary">
                  {chart.authorName?.trim() || '작성자 미지정'}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex h-8 shrink-0 items-center justify-center">
            <DetailsToggle
              chartName={chart.name}
              expanded
              detailsId={detailsId}
              onToggle={() => setExpanded(false)}
              className="h-8 w-10"
            />
          </div>
        </div>
      )}

      <div className={`relative flex h-8 shrink-0 items-center px-3.5 ${expanded ? '' : 'rounded-b-[9px]'}`}>
        <span className="text-xs text-text-tertiary">수정 {formatDate(chart.updatedAt)}</span>
        {!expanded && (
          <DetailsToggle
            chartName={chart.name}
            expanded={false}
            detailsId={detailsId}
            onToggle={() => setExpanded(true)}
            className="absolute inset-y-0 left-1/2 w-10 -translate-x-1/2"
          />
        )}
      </div>
    </article>
  );
}

function DetailsToggle({
  chartName,
  expanded,
  detailsId,
  onToggle,
  className,
}: {
  chartName: string;
  expanded: boolean;
  detailsId: string;
  onToggle: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={detailsId}
      aria-label={`${chartName} 상세 ${expanded ? '접기' : '펼치기'}`}
      onClick={onToggle}
      className={`flex items-center justify-center text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset ${className}`}
    >
      <Triangle
        aria-hidden
        className={`size-3.5 fill-current transition-transform ${expanded ? '' : 'rotate-180'}`}
        strokeWidth={1.5}
      />
    </button>
  );
}
