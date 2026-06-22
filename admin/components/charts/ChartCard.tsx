'use client';

import Link from 'next/link';
import { BarChart3, LineChart, PieChart, ScatterChart, Trash2 } from 'lucide-react';
import type { ChartSummary, ChartType } from '@/lib/api';
import { Button } from '@/components/ui/Button';

// S1 차트 카드(183:29) — 썸네일 + 제목·배지·설명·#id·수정일 + 편집/임베드.
import { MiniChart } from './MiniChart';

const TYPE_META: Record<ChartType, { label: string; Icon: typeof BarChart3 }> = {
  bar: { label: '막대', Icon: BarChart3 },
  line: { label: '선', Icon: LineChart },
  pie: { label: '원형', Icon: PieChart },
  scatter: { label: '분포', Icon: ScatterChart },
};

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

export function ChartCard({ chart, onEmbed, onDelete }: { chart: ChartSummary; onEmbed: (c: ChartSummary) => void; onDelete: (c: ChartSummary) => void }) {
  const { label, Icon } = TYPE_META[chart.chartType];
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-[10px] border border-border bg-bg-panel">
      <div className="flex h-[120px] items-center justify-center bg-muted py-4">
        <div className="h-20 w-60">
          <MiniChart chartType={chart.chartType} />
        </div>
      </div>
      <button
        type="button"
        aria-label="삭제"
        onClick={() => onDelete(chart)}
        className="absolute right-2 top-2 hidden rounded-md bg-bg-panel/90 p-1.5 text-text-secondary shadow-sm hover:text-danger group-hover:block"
      >
        <Trash2 className="size-3.5" />
      </button>

      <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{chart.name}</p>
          <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted pl-1.5 pr-2 text-xs font-medium text-text-primary">
            <Icon className="size-3" />
            {label}
          </span>
        </div>
        <p className="line-clamp-2 min-h-8 text-xs text-text-secondary">{chart.description ?? ''}</p>
        <p className="text-xs text-text-tertiary">
          #{chart.id} · 수정 {formatDate(chart.updatedAt)}
        </p>
        <div className="flex gap-2">
          <Link href={`/charts/${chart.id}`} className="flex-1">
            <Button variant="secondary" size="sm" className="h-7 w-full">
              편집
            </Button>
          </Link>
          <Button variant="secondary" size="sm" className="h-7 flex-1 bg-muted" onClick={() => onEmbed(chart)}>
            임베드
          </Button>
        </div>
      </div>
    </div>
  );
}
