'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Search } from 'lucide-react';
import { adminChartsApi, apiErrorMessage } from '@/lib/api';
import type { AdminChartListResponse, ChartType } from '@/lib/api';
import { AdminSectionNav } from '@/components/admin/AdminSectionNav';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';

const CHART_TYPES = ['bar', 'line', 'pie', 'scatter', 'boxplot', 'heatmap', 'map', 'geoscatter'];

export default function AdminChartsPage() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [owner, setOwner] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminChartListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await adminChartsApi.list({ q: submittedQuery || undefined, ownerId: owner ? Number(owner) : undefined, type: (type || undefined) as ChartType | undefined, page, pageSize: 20 }));
      setError(null);
    } catch (cause) {
      setError(apiErrorMessage(cause, '전체 차트 목록을 불러오지 못했습니다.'));
    }
  }, [owner, page, submittedQuery, type]);
  useEffect(() => { void load(); }, [load]);

  return <section>
    <AdminSectionNav />
    <div className="mb-5 flex items-end justify-between"><div><h1 className="text-2xl font-semibold text-text-primary">전체 차트</h1><p className="mt-1 text-sm text-text-secondary">모든 사용자의 저장 차트를 읽기 전용으로 확인합니다.</p></div><span className="text-sm text-text-secondary">총 {data?.total ?? 0}개</span></div>
    <form className="mb-4 flex flex-wrap gap-2 rounded-lg border border-border bg-bg-panel p-3" onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}>
      <Input className="w-64" aria-label="차트 검색" placeholder="차트 이름 또는 설명" value={query} onChange={(e) => setQuery(e.target.value)} />
      <Input className="w-36" aria-label="소유자 ID" inputMode="numeric" placeholder="소유자 ID" value={owner} onChange={(e) => { setOwner(e.target.value.replace(/\D/g, '')); setPage(1); }} />
      <Select className="w-40" aria-label="차트 유형" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} placeholder="모든 유형" options={CHART_TYPES.map((value) => ({ value, label: value }))} />
      <Button type="submit" size="sm" icon={<Search className="size-4" />}>검색</Button>
    </form>
    {error && <p className="mb-4 rounded-md bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p>}
    {data && data.charts.length === 0 ? <EmptyState icon={<BarChart3 className="size-8 text-text-tertiary" />} title="조건에 맞는 차트가 없습니다." /> : <div className="overflow-hidden rounded-lg border border-border bg-bg-panel"><table className="w-full text-left text-[13px]"><thead className="bg-muted text-text-secondary"><tr><th className="px-4 py-3">차트</th><th className="px-4 py-3">소유자</th><th className="px-4 py-3">유형</th><th className="px-4 py-3">갱신</th><th className="px-4 py-3">수정 시각</th></tr></thead><tbody className="divide-y divide-border">{data?.charts.map((chart) => <tr key={chart.id} className="hover:bg-muted/50"><td className="px-4 py-3"><Link href={`/admin/charts/${chart.id}`} className="font-medium text-text-primary hover:text-primary">{chart.name}</Link><div className="max-w-md truncate text-xs text-text-tertiary">{chart.description || '설명 없음'}</div></td><td className="px-4 py-3">{chart.ownerId ? <Link href={`/admin/users/${chart.ownerId}`} className="hover:text-primary">{chart.ownerDisplayName || chart.ownerUsername}</Link> : <span className="text-danger">미지정</span>}</td><td className="px-4 py-3">{chart.chartType}</td><td className="px-4 py-3">{chart.refreshMode}</td><td className="px-4 py-3">{new Date(chart.updatedAt).toLocaleString('ko-KR')}</td></tr>)}</tbody></table></div>}
    {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
  </section>;
}
