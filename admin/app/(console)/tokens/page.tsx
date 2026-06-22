'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { tokensApi, usersApi } from '@/lib/api';
import type { User, UserToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TokenTable } from '@/components/tokens/TokenTable';
import { IssueTokenModal } from '@/components/tokens/IssueTokenModal';
import { RevokeTokenModal } from '@/components/tokens/RevokeTokenModal';

// S7 토큰 관리(279:373). 사용자별 임베드 토큰 발급·회수.
export default function TokensPage() {
  const [tokens, setTokens] = useState<UserToken[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [issueOpen, setIssueOpen] = useState(false);
  const [toRevoke, setToRevoke] = useState<UserToken | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(() => {
    void Promise.all([tokensApi.list(), usersApi.list()]).then(([t, u]) => {
      setTokens(t);
      setUsers(u);
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const reissue = async (t: UserToken) => {
    await tokensApi.issue(t.userId, 365);
    setToast('토큰을 재발급했습니다');
    reload();
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] pt-2">
      <header className="mb-5 flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text-primary">토큰 관리</h1>
          <p className="text-[13px] text-text-secondary">
            사용자별 임베드 토큰을 발급·회수합니다. 토큰 1개로 모든 차트를 임베드할 수 있으며, 회수하면 그 사용자의 모든 임베드가 무효화됩니다.
          </p>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => setIssueOpen(true)}>
          토큰 발급
        </Button>
      </header>

      {tokens && (
        <TokenTable tokens={tokens} users={users} onRevoke={setToRevoke} onReissue={reissue} />
      )}

      {issueOpen && (
        <IssueTokenModal
          users={users}
          onClose={() => setIssueOpen(false)}
          onIssued={() => {
            setIssueOpen(false);
            setToast('토큰을 발급했습니다');
            reload();
          }}
        />
      )}
      {toRevoke && (
        <RevokeTokenModal
          token={toRevoke}
          users={users}
          onClose={() => setToRevoke(null)}
          onRevoked={() => {
            setToRevoke(null);
            setToast('토큰을 회수했습니다');
            reload();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
