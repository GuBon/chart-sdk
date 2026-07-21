'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Plus } from 'lucide-react';
import { datasourcesApi } from '@/lib/api';
import type { ChartSort, ChartSummary, ChartType, Datasource } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { useChartPage } from '@/components/charts/useChartPage';
import { DeleteChartModal } from '@/components/charts/DeleteChartModal';
import { EmbedModal } from '@/components/charts/EmbedModal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { CHART_TYPE_FILTER_OPTIONS } from '@/lib/chartTypes';

const PAGE_SIZE = 12;

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

  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);

  const setPage = useCallback(
    (nextPage: number) => {
      const bounded = Math.max(1, nextPage);
      const next = new URLSearchParams(params.toString());
      if (bounded <= 1) next.delete('page');
      else next.set('page', String(bounded));
      const query = next.toString();
      router.replace(query ? `/?${query}` : '/', { scroll: false });
    },
    [params, router],
  );

  const { charts, previewOptions, total, totalPages, reload } = useChartPage(
    { q, type, datasourceId: ds === 'all' ? 'all' : Number(ds), sort, page, pageSize: PAGE_SIZE },
    setPage,
  );
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
          <Select id="chart-type-filter" name="chartTypeFilter" aria-label="종류 필터" value={type} options={CHART_TYPE_FILTER_OPTIONS} onChange={(e) => setParam('type', e.target.value)} />
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
        <EmptyState
          className="py-24"
          icon={<BarChart3 className="size-9 text-text-tertiary" />}
          title={hasFilter ? '조건에 맞는 차트가 없습니다' : '아직 만든 차트가 없습니다'}
          description={hasFilter ? undefined : '첫 차트를 만들어 임베드해 보세요.'}
          action={hasFilter ? (
            <button type="button" onClick={() => router.replace('/', { scroll: false })} className="text-[13px] text-primary hover:underline">필터 초기화</button>
          ) : (
            <Link href="/charts/new"><Button size="sm" className="h-9" icon={<Plus className="size-4" />}>첫 차트 만들기</Button></Link>
          )}
        />
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

      {charts && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}

      {toDelete && <DeleteChartModal chart={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); reload(); }} />}
      {toEmbed && <EmbedModal chart={toEmbed} onClose={() => setToEmbed(null)} />}
    </>
  );
}
