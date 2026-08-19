'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { adminUsersApi, apiErrorMessage } from '@/lib/api';
import type { AdminUserDetailResponse } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

type PendingAction = { kind: 'status'; value: boolean } | { kind: 'role'; value: 'member' | 'admin' };

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const auth = useAuth();
  const [data, setData] = useState<AdminUserDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminUsersApi.get(userId));
      setError(null);
    } catch (cause) {
      setError(apiErrorMessage(cause, '사용자 정보를 불러오지 못했습니다.'));
    }
  }, [userId]);
  useEffect(() => { if (Number.isFinite(userId)) void load(); }, [load, userId]);

  async function applyAction() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      const next = pending.kind === 'status'
        ? await adminUsersApi.setStatus(userId, pending.value)
        : await adminUsersApi.setRole(userId, pending.value);
      setData(next);
      setPending(null);
      if (auth.status === 'authenticated' && auth.user.id === userId && pending.kind === 'role') {
        window.location.replace('/login');
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, '사용자 정보를 변경하지 못했습니다.'));
      setPending(null);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return <p className="text-sm text-text-secondary">{error ?? '사용자 정보를 불러오는 중…'}</p>;
  }
  const { user, summary, embedKeys } = data;
  const isSelf = auth.status === 'authenticated' && auth.user.id === user.id;

  return (
    <section>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"><ArrowLeft className="size-4" />사용자 목록</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold text-text-primary">{user.displayName || user.username}</h1><p className="mt-1 text-sm text-text-secondary">{user.username} · 가입 {formatDate(user.createdAt)}</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setPending({ kind: 'role', value: user.role === 'admin' ? 'member' : 'admin' })}>{user.role === 'admin' ? '일반 사용자로 변경' : '관리자로 변경'}</Button>
          <Button variant={user.active ? 'danger' : 'primary'} disabled={isSelf && user.active} title={isSelf && user.active ? '현재 로그인한 계정은 비활성화할 수 없습니다.' : undefined} onClick={() => setPending({ kind: 'status', value: !user.active })}>{user.active ? '사용자 비활성화' : '사용자 활성화'}</Button>
        </div>
      </div>
      {error && <p className="mt-4 rounded-md bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="역할" value={user.role === 'admin' ? '관리자' : '일반 사용자'} />
        <Stat label="상태" value={user.active ? '활성' : '비활성'} />
        <Stat label="활성 세션" value={summary.activeSessions} />
        <Stat label="전체 차트" value={summary.chartCount} />
        <Stat label="임베드 중인 차트" value={summary.embeddedChartCount} />
        <Stat label="활성 임베드 키" value={summary.activeEmbedKeyCount} />
        <Stat label="만료된 임베드 키" value={summary.expiredEmbedKeyCount} />
        <Stat label="회수된 임베드 키" value={summary.revokedEmbedKeyCount} />
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border bg-bg-panel">
        <div className="border-b border-border px-4 py-3"><h2 className="font-semibold text-text-primary">차트별 임베드 키 현황</h2><p className="mt-0.5 text-xs text-text-secondary">키 원문은 관리자에게 제공하지 않습니다. 마지막 발급: {summary.lastEmbedKeyIssuedAt ? formatDate(summary.lastEmbedKeyIssuedAt) : '없음'}</p></div>
        {embedKeys.length === 0 ? <p className="p-6 text-center text-sm text-text-secondary">발급 이력이 없습니다.</p> : (
          <table className="w-full text-left text-[13px]"><thead className="bg-muted text-text-secondary"><tr><th className="px-4 py-3">차트</th><th className="px-4 py-3">상태</th><th className="px-4 py-3">발급</th><th className="px-4 py-3">만료</th><th className="px-4 py-3">회수 사유</th></tr></thead><tbody className="divide-y divide-border">{embedKeys.map((key) => <tr key={key.id}><td className="px-4 py-3"><Link href={`/admin/charts/${key.chartId}`} className="font-medium hover:text-primary">{key.chartName}</Link></td><td className="px-4 py-3">{statusLabel(key.status)}</td><td className="px-4 py-3">{formatDate(key.createdAt)}</td><td className="px-4 py-3">{formatDate(key.expiresAt)}</td><td className="px-4 py-3">{key.revokedReason ?? '-'}</td></tr>)}</tbody></table>
        )}
      </div>

      {pending && <Modal title="변경 확인" onClose={() => setPending(null)} footer={<><Button variant="secondary" onClick={() => setPending(null)}>취소</Button><Button variant={pending.kind === 'status' && !pending.value ? 'danger' : 'primary'} disabled={saving} onClick={() => void applyAction()}>{saving ? '변경 중…' : '변경'}</Button></>}><p className="text-sm text-text-secondary">{actionDescription(pending)} 역할이나 상태를 변경하면 이 사용자의 기존 로그인 세션이 모두 만료됩니다.</p></Modal>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-border bg-bg-panel p-4"><div className="text-xs text-text-secondary">{label}</div><div className="mt-1 text-xl font-semibold text-text-primary">{value}</div></div>;
}

function formatDate(value: string) { return new Date(value).toLocaleString('ko-KR'); }
function statusLabel(status: string) { return status === 'ACTIVE' ? '활성' : status === 'EXPIRED' ? '만료' : '회수'; }
function actionDescription(action: PendingAction) {
  if (action.kind === 'role') return action.value === 'admin' ? '관리자 권한을 부여합니다.' : '관리자 권한을 회수합니다.';
  return action.value ? '사용자를 다시 활성화합니다.' : '사용자를 비활성화하고 모든 임베드 키를 회수합니다.';
}
