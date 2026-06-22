'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Plus } from 'lucide-react';
import { chartsApi } from '@/lib/api';
import type { ChartSummary } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { DeleteChartModal } from '@/components/charts/DeleteChartModal';
import { EmbedModal } from '@/components/charts/EmbedModal';
import { Button } from '@/components/ui/Button';

// S1 차트 목록(183:16). 검색은 AppBar(?q) → useSearchParams 로 읽어 필터.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChartList />
    </Suspense>
  );
}

function ChartList() {
  const q = useSearchParams().get('q') ?? '';
  const [charts, setCharts] = useState<ChartSummary[] | null>(null);
  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);

  const reload = useCallback(() => {
    void chartsApi.list(q).then(setCharts).catch(() => setCharts([]));
  }, [q]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (charts && charts.length === 0 && !q) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-border bg-bg-panel py-24 text-center">
        <BarChart3 className="size-9 text-text-tertiary" />
        <p className="text-base font-semibold text-text-primary">아직 만든 차트가 없습니다</p>
        <p className="text-[13px] text-text-secondary">첫 차트를 만들어 임베드해 보세요.</p>
        <Link href="/charts/new" className="mt-1">
          <Button size="sm" className="h-9" icon={<Plus className="size-4" />}>
            첫 차트 만들기
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      {q && <p className="mb-4 text-[13px] text-text-secondary">‘{q}’ 검색 결과 {charts?.length ?? 0}건</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {charts?.map((c) => (
          <ChartCard key={c.id} chart={c} onEmbed={setToEmbed} onDelete={setToDelete} />
        ))}
        {!q && (
          <Link
            href="/charts/new"
            className="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border text-text-tertiary transition-colors hover:border-text-tertiary hover:text-text-secondary"
          >
            <Plus className="size-6" />
            <span className="text-[13px]">새 차트 만들기</span>
          </Link>
        )}
      </div>

      {toDelete && <DeleteChartModal chart={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); reload(); }} />}
      {toEmbed && <EmbedModal chart={toEmbed} onClose={() => setToEmbed(null)} />}
    </>
  );
}
