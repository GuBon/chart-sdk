'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ApiError, tokensApi, usersApi } from '@/lib/api';
import type { User } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// S7 토큰 발급 모달(280:374). 새 사용자 인라인 생성 → 즉시 발급(인증 구현 전 동선).
export function IssueTokenModal({ users, onClose, onIssued }: { users: User[]; onClose: () => void; onIssued: () => void }) {
  const [userId, setUserId] = useState<number | null>(users[0]?.id ?? null);
  const [days, setDays] = useState('365');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiry = new Date(Date.now() + (Number(days) || 0) * 86400000).toISOString().slice(0, 10);
  const canIssue = creating ? !!newName.trim() && !!newDisplay.trim() : userId != null;

  const issue = async () => {
    setIssuing(true);
    setError(null);
    try {
      let targetId = userId;
      if (creating) {
        const u = await usersApi.create({ username: newName.trim(), displayName: newDisplay.trim() });
        targetId = u.id;
      }
      if (targetId == null) return;
      await tokensApi.issue(targetId, Number(days) || 365);
      onIssued();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '발급에 실패했습니다.');
      setIssuing(false);
    }
  };

  return (
    <Modal
      title="토큰 발급"
      width={520}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-[34px]" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" className="h-[34px]" disabled={!canIssue || issuing} onClick={issue}>
            {issuing ? '발급 중…' : '발급'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="사용자">
          {creating ? (
            <div className="flex gap-2">
              <Input size="md" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="username" />
              <Input size="md" value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder="표시명" />
            </div>
          ) : (
            <Select
              aria-label="사용자"
              value={userId ?? ''}
              onChange={(e) => setUserId(Number(e.target.value))}
              options={users.map((u) => ({ value: u.id, label: `${u.username} (${u.displayName})` }))}
            />
          )}
          <button type="button" onClick={() => setCreating((v) => !v)} className="mt-1.5 flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary">
            <Plus className="size-3" />
            {creating ? '기존 사용자 선택' : '새 사용자 만들기 — username · 표시명 입력 후 즉시 발급 가능'}
          </button>
        </Field>

        <Field label="만료 기간">
          <div className="flex items-center gap-2">
            <div className="w-[120px]">
              <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
            </div>
            <span className="text-[13px] text-text-secondary">일 (만료: {expiry})</span>
          </div>
        </Field>

        <p className="rounded-md bg-info/10 px-3 py-2.5 text-xs text-info">
          이 토큰 하나로 모든 차트를 임베드할 수 있습니다. 목록에서는 앞부분만 표시되며, 전체 토큰은 임베드 코드 모달에서 선택해 사용합니다.
        </p>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
