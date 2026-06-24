'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Plus } from 'lucide-react';
import { chartsApi, datasourcesApi } from '@/lib/api';
import type { ChartSort, ChartSummary, ChartType, Datasource } from '@/lib/api';
import { ChartCard } from '@/components/charts/ChartCard';
import { DeleteChartModal } from '@/components/charts/DeleteChartModal';
import { EmbedModal } from '@/components/charts/EmbedModal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';

const TYPE_OPTIONS = [
  { value: 'all', label: '모든 종류' },
  { value: 'bar', label: '막대' },
  { value: 'line', label: '선' },
  { value: 'pie', label: '원형' },
  { value: 'scatter', label: '분포' },
];
const SORT_OPTIONS = [
  { value: 'updated_desc', label: '최신 수정순' },
  { value: 'updated_asc', label: '오래된 수정순' },
  { value: 'name_asc', label: '이름 ㄱ→ㅎ' },
  { value: 'name_desc', label: '이름 ㅎ→ㄱ' },
];

// S1 차트 목록(183:16). 검색(q)은 AppBar, 종류·데이터소스·정렬은 본 화면 필터바 → 전부 URL 쿼리로 보존.
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

  const [charts, setCharts] = useState<ChartSummary[] | null>(null);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);

  const reload = useCallback(() => {
    void chartsApi
      .list({ q, type, datasourceId: ds === 'all' ? 'all' : Number(ds), sort })
      .then(setCharts)
      .catch(() => setCharts([]));
  }, [q, type, ds, sort]);

  useEffect(() => void reload(), [reload]);
  useEffect(() => void datasourcesApi.list().then(setDatasources).catch(() => {}), []);

  // 필터 변경 → URL 갱신. 기본값(all·updated_desc)은 쿼리에서 제거해 URL 을 깔끔히.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'all' || (key === 'sort' && value === 'updated_desc')) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `/?${query}` : '/', { scroll: false });
  };

  const hasFilter = !!q || type !== 'all' || ds !== 'all';
  const dsOptions = [{ value: 'all', label: '모든 데이터소스' }, ...datasources.map((d) => ({ value: String(d.id), label: d.name }))];

  return (
    <>
      {/* 필터바 — 종류·데이터소스·정렬 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-32"><Select aria-label="종류 필터" value={type} options={TYPE_OPTIONS} onChange={(e) => setParam('type', e.target.value)} /></div>
        <div className="w-44"><Select aria-label="데이터소스 필터" value={ds} options={dsOptions} onChange={(e) => setParam('datasourceId', e.target.value)} /></div>
        <div className="w-36"><Select aria-label="정렬" value={sort} options={SORT_OPTIONS} onChange={(e) => setParam('sort', e.target.value)} /></div>
        <div className="flex-1" />
        {charts && <span className="text-[13px] text-text-secondary">{hasFilter ? `${charts.length}건` : `전체 ${charts.length}개`}</span>}
      </div>

      {charts && charts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-border bg-bg-panel py-24 text-center">
          <BarChart3 className="size-9 text-text-tertiary" />
          <p className="text-base font-semibold text-text-primary">{hasFilter ? '조건에 맞는 차트가 없습니다' : '아직 만든 차트가 없습니다'}</p>
          {hasFilter ? (
            <button type="button" onClick={() => router.replace('/', { scroll: false })} className="text-[13px] text-primary hover:underline">필터 초기화</button>
          ) : (
            <>
              <p className="text-[13px] text-text-secondary">첫 차트를 만들어 임베드해 보세요.</p>
              <Link href="/charts/new" className="mt-1">
                <Button size="sm" className="h-9" icon={<Plus className="size-4" />}>첫 차트 만들기</Button>
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {charts?.map((c) => (
            <ChartCard key={c.id} chart={c} onEmbed={setToEmbed} onDelete={setToDelete} />
          ))}
          {!hasFilter && (
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

      {toDelete && <DeleteChartModal chart={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); reload(); }} />}
      {toEmbed && <EmbedModal chart={toEmbed} onClose={() => setToEmbed(null)} />}
    </>
  );
}
