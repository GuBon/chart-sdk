'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { adminUsersApi, apiErrorMessage } from '@/lib/api';
import type { AdminUserListResponse } from '@/lib/api';
import { AdminSectionNav } from '@/components/admin/AdminSectionNav';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUserListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await adminUsersApi.list({
        q: submittedQuery || undefined,
        status: (status || undefined) as 'active' | 'inactive' | undefined,
        role: (role || undefined) as 'member' | 'admin' | undefined,
        page,
        pageSize: 20,
      }));
    } catch (cause) {
      setError(apiErrorMessage(cause, '사용자 목록을 불러오지 못했습니다.'));
    }
  }, [page, role, status, submittedQuery]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section>
      <AdminSectionNav />
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">사용자 관리</h1>
          <p className="mt-1 text-sm text-text-secondary">계정 상태와 역할을 관리하고 사용 현황을 확인합니다.</p>
        </div>
        <span className="text-sm text-text-secondary">총 {data?.total ?? 0}명</span>
      </div>

      <form
        className="mb-4 flex flex-wrap gap-2 rounded-lg border border-border bg-bg-panel p-3"
        onSubmit={(event) => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()); }}
      >
        <Input className="w-64" aria-label="사용자 검색" placeholder="아이디 또는 표시 이름" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select className="w-32" aria-label="상태" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="모든 상태" options={[{ value: 'active', label: '활성' }, { value: 'inactive', label: '비활성' }]} />
        <Select className="w-32" aria-label="역할" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} placeholder="모든 역할" options={[{ value: 'member', label: '일반 사용자' }, { value: 'admin', label: '관리자' }]} />
        <Button type="submit" size="sm" icon={<Search className="size-4" />}>검색</Button>
      </form>

      {error && <p className="mb-4 rounded-md bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p>}
      {data && data.users.length === 0 ? (
        <EmptyState icon={<Users className="size-8 text-text-tertiary" />} title="조건에 맞는 사용자가 없습니다." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-bg-panel">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-muted text-text-secondary"><tr><th className="px-4 py-3">사용자</th><th className="px-4 py-3">역할</th><th className="px-4 py-3">상태</th><th className="px-4 py-3 text-right">차트</th><th className="px-4 py-3 text-right">임베드 중</th><th className="px-4 py-3 text-right">세션</th></tr></thead>
            <tbody className="divide-y divide-border">
              {data?.users.map((user) => (
                <tr key={user.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3"><Link href={`/admin/users/${user.id}`} className="font-medium text-text-primary hover:text-primary">{user.displayName || user.username}</Link><div className="text-xs text-text-tertiary">{user.username}</div></td>
                  <td className="px-4 py-3">{user.role === 'admin' ? '관리자' : '일반 사용자'}</td>
                  <td className="px-4 py-3"><span className={user.active ? 'text-success' : 'text-danger'}>{user.active ? '활성' : '비활성'}</span></td>
                  <td className="px-4 py-3 text-right">{user.chartCount}</td>
                  <td className="px-4 py-3 text-right">{user.embeddedChartCount}</td>
                  <td className="px-4 py-3 text-right">{user.activeSessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </section>
  );
}
