'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { adminChartsApi, apiErrorMessage } from '@/lib/api';
import type { AdminChartDetail, ChartDataResponse } from '@/lib/api';
import { ChartPreview } from '@/components/charts/ChartPreview';

export default function AdminChartDetailPage() {
  const params = useParams<{ id: string }>();
  const chartId = Number(params.id);
  const [chart, setChart] = useState<AdminChartDetail | null>(null);
  const [preview, setPreview] = useState<ChartDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setChart(await adminChartsApi.get(chartId));
      setError(null);
    } catch (cause) {
      setError(apiErrorMessage(cause, '차트 정보를 불러오지 못했습니다.'));
    }
    try {
      setPreview(await adminChartsApi.preview(chartId));
      setPreviewError(null);
    } catch (cause) {
      setPreviewError(apiErrorMessage(cause, '차트 미리보기를 불러오지 못했습니다.'));
    }
  }, [chartId]);
  useEffect(() => { if (Number.isFinite(chartId)) void load(); }, [chartId, load]);

  if (!chart) return <p className="text-sm text-text-secondary">{error ?? '차트 정보를 불러오는 중…'}</p>;
  return <section>
    <Link href="/admin/charts" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="size-4" />전체 차트</Link>
    <div><div className="mb-1 inline-flex rounded bg-muted px-2 py-1 text-xs text-text-secondary">관리자 읽기 전용</div><h1 className="text-2xl font-semibold text-text-primary">{chart.name}</h1><p className="mt-1 text-sm text-text-secondary">{chart.description || '설명 없음'}</p></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <div className="rounded-lg border border-border bg-bg-panel p-4"><h2 className="mb-3 font-semibold text-text-primary">미리보기</h2>{preview ? <div className="h-[480px]"><ChartPreview option={preview.option} /></div> : <div className="grid h-[480px] place-items-center text-sm text-text-secondary">{previewError ?? '미리보기를 불러오는 중…'}</div>}</div>
      <aside className="space-y-4">
        <div className="rounded-lg border border-border bg-bg-panel p-4"><h2 className="mb-3 font-semibold text-text-primary">차트 정보</h2><Info label="소유자" value={chart.ownerId ? `${chart.ownerDisplayName || chart.ownerUsername} (#${chart.ownerId})` : '미지정'} /><Info label="차트 유형" value={chart.chartType} /><Info label="정의 방식" value={chart.defineMode} /><Info label="갱신 방식" value={chart.refreshMode} /><Info label="데이터소스" value={`${chart.datasourceName ?? '이름 없음'} (#${chart.datasourceId})`} /><Info label="정의 버전" value={chart.version} /><Info label="수정 시각" value={new Date(chart.updatedAt).toLocaleString('ko-KR')} /></div>
        <div className="rounded-lg border border-border bg-bg-panel p-4"><h2 className="mb-2 font-semibold text-text-primary">저장 SQL</h2><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-bg-base p-3 text-xs text-text-secondary">{chart.sqlQuery}</pre></div>
      </aside>
    </div>
  </section>;
}

function Info({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between gap-4 border-b border-border py-2 text-[13px] last:border-0"><span className="text-text-secondary">{label}</span><span className="text-right text-text-primary">{value}</span></div>;
}
