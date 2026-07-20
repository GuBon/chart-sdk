'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Plus } from 'lucide-react';
import { chartsApi, datasourcesApi } from '@/lib/api';
import type { ChartOptions, ChartSort, ChartSummary, ChartType, Datasource } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { DeleteChartModal } from '@/components/charts/DeleteChartModal';
import { EmbedModal } from '@/components/charts/EmbedModal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';

const PAGE_SIZE = 12;

const TYPE_OPTIONS = [
  { value: 'all', label: '모든 종류' },
  { value: 'bar', label: '막대' },
  { value: 'line', label: '선' },
  { value: 'pie', label: '원형' },
  { value: 'scatter', label: '분포' },
  { value: 'boxplot', label: '박스 플롯' },
  { value: 'heatmap', label: '히트맵' },
  { value: 'map', label: '지도' },
  { value: 'geoscatter', label: '지도 포인트' },
];

const SORT_OPTIONS = [
  { value: 'updated_desc', label: '최신 수정순' },
  { value: 'updated_asc', label: '오래된 수정순' },
  { value: 'name_asc', label: '이름 오름차순' },
  { value: 'name_desc', label: '이름 내림차순' },
];

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChartList />
    </Suspense>
  );
}

function ChartList() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const type = (params.get('type') ?? 'all') as ChartType | 'all';
  const ds = params.get('datasourceId') ?? 'all';
  const sort = (params.get('sort') ?? 'updated_desc') as ChartSort;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [charts, setCharts] = useState<ChartSummary[] | null>(null);
  const [previewOptions, setPreviewOptions] = useState<Record<number, ChartOptions | null>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);

  const setPage = useCallback(
    (nextPage: number, maxPages = totalPages) => {
      const bounded = Math.min(Math.max(1, nextPage), Math.max(1, maxPages));
      const next = new URLSearchParams(params.toString());
      if (bounded <= 1) next.delete('page');
      else next.set('page', String(bounded));
      const query = next.toString();
      router.replace(query ? `/?${query}` : '/', { scroll: false });
    },
    [params, router, totalPages],
  );

  const reload = useCallback(() => {
    void chartsApi
      .list({ q, type, datasourceId: ds === 'all' ? 'all' : Number(ds), sort, page, pageSize: PAGE_SIZE })
      .then((res) => {
        setCharts(res.charts);
        setPreviewOptions({});
        setTotal(res.total);
        setTotalPages(res.totalPages);
        // 페이지 초과(필터·삭제로 총 페이지 감소) 보정. setPage 는 totalPages 에 의존하므로 deps 에 넣으면
        // 최초 로드에서 totalPages 갱신이 reload 를 재생성 → useEffect 재실행 → 목록·미리보기 중복 조회 사이클이 된다.
        // URL 을 직접 치환해 그 사이클을 끊는다.
        if (page > res.totalPages) {
          const next = new URLSearchParams(params.toString());
          if (res.totalPages <= 1) next.delete('page');
          else next.set('page', String(res.totalPages));
          const query = next.toString();
          router.replace(query ? `/?${query}` : '/', { scroll: false });
        }
      })
      .catch(() => {
        setCharts([]);
        setPreviewOptions({});
        setTotal(0);
        setTotalPages(1);
      });
  }, [q, type, ds, sort, page, params, router]);

  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    if (!charts?.length) return;
    let alive = true;
    const ids = charts.map((chart) => chart.id);
    void chartsApi.previews(ids).then((res) => {
      if (!alive) return;
      const next: Record<number, ChartOptions | null> = {};
      for (const id of ids) {
        next[id] = res.previews[String(id)]?.option ?? null;
      }
      setPreviewOptions(next);
    }).catch(() => {
      if (!alive) return;
      const failed: Record<number, ChartOptions | null> = {};
      for (const id of ids) failed[id] = null;
      setPreviewOptions(failed);
    });
    return () => {
      alive = false;
    };
  }, [charts]);
  useEffect(() => void datasourcesApi.list().then(setDatasources).catch(() => {}), []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'all' || (key === 'sort' && value === 'updated_desc')) next.delete(key);
    else next.set(key, value);
    next.delete('page');
    const query = next.toString();
    router.replace(query ? `/?${query}` : '/', { scroll: false });
  };

  const hasFilter = !!q || type !== 'all' || ds !== 'all';
  const dsOptions = [{ value: 'all', label: '모든 데이터소스' }, ...datasources.map((d) => ({ value: String(d.id), label: d.name }))];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-32">
          <Select id="chart-type-filter" name="chartTypeFilter" aria-label="종류 필터" value={type} options={TYPE_OPTIONS} onChange={(e) => setParam('type', e.target.value)} />
        </div>
        <div className="w-44">
          <Select id="chart-datasource-filter" name="chartDatasourceFilter" aria-label="데이터소스 필터" value={ds} options={dsOptions} onChange={(e) => setParam('datasourceId', e.target.value)} />
        </div>
        <div className="w-40">
          <Select id="chart-sort" name="chartSort" aria-label="정렬" value={sort} options={SORT_OPTIONS} onChange={(e) => setParam('sort', e.target.value)} />
        </div>
        <div className="flex-1" />
        {charts && (
          <span className="text-[13px] text-text-secondary">
            {hasFilter ? `${total}건` : `전체 ${total}개`}
          </span>
        )}
      </div>

      {charts && charts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-border bg-bg-panel py-24 text-center">
          <BarChart3 className="size-9 text-text-tertiary" />
          <p className="text-base font-semibold text-text-primary">
            {hasFilter ? '조건에 맞는 차트가 없습니다' : '아직 만든 차트가 없습니다'}
          </p>
          {hasFilter ? (
            <button type="button" onClick={() => router.replace('/', { scroll: false })} className="text-[13px] text-primary hover:underline">
              필터 초기화
            </button>
          ) : (
            <>
              <p className="text-[13px] text-text-secondary">첫 차트를 만들어 임베드해 보세요.</p>
              <Link href="/charts/new" className="mt-1">
                <Button size="sm" className="h-9" icon={<Plus className="size-4" />}>
                  첫 차트 만들기
                </Button>
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {charts?.map((c) => (
            <ChartCard key={c.id} chart={c} previewOption={previewOptions[c.id]} onEmbed={setToEmbed} onDelete={setToDelete} />
          ))}
          {!hasFilter && page === 1 && (
            <Link
              href="/charts/new"
              className="flex min-h-[230px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border text-text-tertiary transition-colors hover:border-text-tertiary hover:text-text-secondary"
            >
              <Plus className="size-6" />
              <span className="text-[13px]">새 차트 만들기</span>
            </Link>
          )}
        </div>
      )}

      {charts && totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            이전
          </Button>
          <span className="min-w-24 text-center text-[13px] text-text-secondary">
            {page} / {totalPages}
          </span>
          <Button variant="secondary" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            다음
          </Button>
        </div>
      )}

      {toDelete && <DeleteChartModal chart={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); reload(); }} />}
      {toEmbed && <EmbedModal chart={toEmbed} onClose={() => setToEmbed(null)} />}
    </>
  );
}
