'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, KeyRound, Plus } from 'lucide-react';
import { apiErrorMessage, tokensApi, usersApi } from '@/lib/api';
import type { User, UserToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toast, useToast } from '@/components/ui/Toast';
import { TokenTable } from '@/components/tokens/TokenTable';
import { IssueTokenModal } from '@/components/tokens/IssueTokenModal';
import { RevokeTokenModal } from '@/components/tokens/RevokeTokenModal';

// S7 토큰 관리(279:373). 사용자별 임베드 토큰 발급·회수.
export default function TokensPage() {
  const [tokens, setTokens] = useState<UserToken[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reissuingId, setReissuingId] = useState<number | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [toRevoke, setToRevoke] = useState<UserToken | null>(null);
  const { notice: toast, show: showToast } = useToast();
  // state(reissuingId)만으로는 반영 전 같은 틱 연속 클릭을 못 막으므로 ref 잠금을 함께 둔다.
  const reissueLock = useRef(false);

  const reload = useCallback(() => {
    setError(null);
    void Promise.all([tokensApi.list(), usersApi.list()])
      .then(([t, u]) => { setTokens(t); setUsers(u); })
      // 로드 실패를 빈 화면으로 두지 않는다 — 오류 상태로 분리해 재시도를 안내한다.
      .catch(() => setError('토큰 목록을 불러오지 못했습니다.'));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reissue = async (t: UserToken) => {
    if (reissueLock.current) return; // 같은 틱 더블클릭까지 방어(state 반영 전)
    reissueLock.current = true;
    setReissuingId(t.tokenId);
    try {
      const issued = await tokensApi.issue(t.userId, 365);
      // 서버 성공을 즉시 목록에 반영한다(reload 를 던져두지 않음). 재조회 전까지 예전 활성 토큰의
      // 버튼이 다시 눌리는 틈을 없앤다. 서버 회전(사용자별 활성 1개)을 그대로 미러링한다.
      setTokens((current) => current
        ? [
            ...current.map((token) => token.userId === issued.userId && token.isActive
              ? { ...token, isActive: false }
              : token),
            issued,
          ]
        : current);
      showToast('토큰을 재발급했습니다');
    } catch (e) {
      showToast(apiErrorMessage(e, '토큰 재발급에 실패했습니다'));
    } finally {
      setReissuingId(null);
      reissueLock.current = false;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] pt-2">
      <header className="mb-5 flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text-primary">사용자·레거시 토큰 관리</h1>
          <p className="text-[13px] text-text-secondary">
            사용자 계정과 레거시 JWT를 관리합니다. 신규 차트 임베드는 각 차트의 ‘임베드 코드’에서 발급하는 전용 키를 사용합니다.
          </p>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="h-9" icon={<Plus className="size-4" />} disabled={reissuingId !== null} onClick={() => setIssueOpen(true)}>
          토큰 발급
        </Button>
      </header>

      {error ? (
        <EmptyState
          icon={<AlertTriangle className="size-8 text-danger" />}
          title="토큰 목록을 불러오지 못했습니다"
          description="네트워크 또는 서버 상태를 확인한 뒤 다시 시도해 주세요."
          action={<Button size="sm" variant="secondary" className="h-9" onClick={reload}>다시 시도</Button>}
        />
      ) : tokens && tokens.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="size-8 text-text-tertiary" />}
          title="발급된 토큰이 없습니다"
          description="현재 발급된 레거시 JWT가 없습니다. 신규 임베드는 차트별 전용 키를 사용하세요."
          action={<Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => setIssueOpen(true)}>토큰 발급</Button>}
        />
      ) : tokens ? (
        <TokenTable tokens={tokens} users={users} onRevoke={setToRevoke} onReissue={reissue} reissuingId={reissuingId} />
      ) : null}

      {issueOpen && (
        <IssueTokenModal
          users={users}
          onClose={() => setIssueOpen(false)}
          onIssued={() => {
            setIssueOpen(false);
            showToast('토큰을 발급했습니다');
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
            showToast('토큰을 회수했습니다');
            reload();
          }}
        />
      )}

      <Toast notice={toast} />
    </div>
  );
}
