'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Plus } from 'lucide-react';
import type { ChartSort, ChartSummary, ChartType, Datasource } from '@/lib/api';
import { chartDatasourcePath } from '@/lib/chartRoutes';
import { CHART_TYPE_FILTER_OPTIONS } from '@/lib/chartTypes';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { ChartCard } from './ChartCard';
import { DeleteChartModal } from './DeleteChartModal';
import { EmbedModal } from './EmbedModal';
import { useChartPage } from './useChartPage';
import { SearchBox } from '@/components/layout/SearchBox';

const PAGE_SIZE = 8;

const SORT_OPTIONS = [
  { value: 'updated_desc', label: '최신 수정순' },
  { value: 'updated_asc', label: '오래된 수정순' },
  { value: 'name_asc', label: '이름 오름차순' },
  { value: 'name_desc', label: '이름 내림차순' },
];

interface Props {
  datasources: Datasource[];
  selectedDatasource?: Datasource | null;
  schema?: string;
  relation?: string;
  catalogHref?: string;
}

/** 홈과 데이터소스·스키마·관계 경로가 공유하는 차트 목록·필터·정렬 UI. */
export function ChartListView({ datasources, selectedDatasource = null, schema, relation, catalogHref }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const paramsString = params.toString();
  const pendingParamsRef = useRef(paramsString);
  const q = params.get('q') ?? '';
  const type = (params.get('type') ?? 'all') as ChartType | 'all';
  const sort = (params.get('sort') ?? 'updated_desc') as ChartSort;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);

  useEffect(() => {
    pendingParamsRef.current = paramsString;
  }, [paramsString]);

  const navigate = useCallback((path: string, next: URLSearchParams) => {
    const query = next.toString();
    pendingParamsRef.current = query;
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  }, [router]);

  const setPage = useCallback((nextPage: number) => {
    const next = new URLSearchParams(pendingParamsRef.current);
    if (nextPage <= 1) next.delete('page');
    else next.set('page', String(nextPage));
    navigate(pathname, next);
  }, [navigate, pathname]);

  const { charts, previewOptions, totalPages, reload } = useChartPage(
    {
      q,
      type,
      datasourceId: selectedDatasource?.id ?? 'all',
      schema,
      relation,
      sort,
      page,
      pageSize: PAGE_SIZE,
    },
    setPage,
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(pendingParamsRef.current);
    if (!value || value === 'all' || (key === 'sort' && value === 'updated_desc')) next.delete(key);
    else next.set(key, value);
    next.delete('page');
    next.delete('view');
    navigate(pathname, next);
  };

  const selectDatasource = (name: string) => {
    const next = new URLSearchParams(pendingParamsRef.current);
    next.delete('page');
    next.delete('view');
    next.delete('datasource');
    next.delete('datasourceId');
    navigate(name === 'all' ? '/' : chartDatasourcePath(name), next);
  };

  const clearFilters = () => router.replace('/', { scroll: false });

  const hasSecondaryFilter = !!q || type !== 'all';
  const isScoped = selectedDatasource !== null;
  const hasFilter = hasSecondaryFilter || isScoped;
  const datasourceOptions = [
    { value: 'all', label: '모든 데이터소스' },
    ...datasources.map((datasource) => ({ value: datasource.name, label: datasource.name })),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-32">
          <Select id="chart-type-filter" name="chartTypeFilter" aria-label="종류 필터" value={type} options={CHART_TYPE_FILTER_OPTIONS} onChange={(event) => setParam('type', event.target.value)} />
        </div>
        <div className="w-44">
          <Select
            id="chart-datasource-filter"
            name="chartDatasourceFilter"
            aria-label="데이터소스 필터"
            value={selectedDatasource?.name ?? 'all'}
            options={datasourceOptions}
            onChange={(event) => selectDatasource(event.target.value)}
          />
        </div>
        <div className="w-40">
          <Select id="chart-sort" name="chartSort" aria-label="정렬" value={sort} options={SORT_OPTIONS} onChange={(event) => setParam('sort', event.target.value)} />
        </div>
        <div className="flex-1" />
        {catalogHref && (
          <Link href={catalogHref} className="whitespace-nowrap text-[13px] font-medium text-text-secondary hover:text-text-primary">
            데이터 탐색
          </Link>
        )}
        <SearchBox />
      </div>

      {charts && charts.length === 0 ? (
        <EmptyState
          className="py-24"
          icon={<BarChart3 className="size-9 text-text-tertiary" />}
          title={hasSecondaryFilter
            ? '조건에 맞는 차트가 없습니다'
            : relation
              ? '이 테이블을 사용하는 차트가 없습니다'
              : schema
                ? '이 스키마를 사용하는 차트가 없습니다'
                : isScoped
                  ? '이 데이터소스를 사용하는 차트가 없습니다'
                  : '아직 만든 차트가 없습니다'}
          description={!hasFilter ? '첫 차트를 만들어 임베드해 보세요.' : undefined}
          action={hasSecondaryFilter ? (
            <button type="button" onClick={clearFilters} className="text-[13px] text-primary hover:underline">필터 초기화</button>
          ) : isScoped ? (
            <Link href="/" className="text-[13px] text-primary hover:underline">모든 차트 보기</Link>
          ) : (
            <Link href="/charts/new"><Button size="sm" className="h-9" icon={<Plus className="size-4" />}>첫 차트 만들기</Button></Link>
          )}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {charts?.map((chart) => (
            <ChartCard key={chart.id} chart={chart} previewOption={previewOptions[chart.id]} onEmbed={setToEmbed} onDelete={setToDelete} />
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
